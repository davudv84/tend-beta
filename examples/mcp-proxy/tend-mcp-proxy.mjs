#!/usr/bin/env node
// TEND in front of any MCP server, for any MCP-capable agent (Claude Desktop, Claude Code, an Agents SDK, Hermes Agent, your own client).
// The agent's MCP host starts this proxy instead of the server; the proxy starts the real server and passes every message through untouched,
// EXCEPT `tools/call`: that is allowed only if TEND allows exactly that tool with exactly those arguments (by policy, or because a person approved
// it), and then it is forwarded once. Anything else (refused, rejected, expired, revoked, TEND unreachable) answers the host with a tool error and
// the real server never sees the call. Every decision and every forwarded call is in TEND's audit log.
//
//   In the MCP host's configuration, instead of  { "command": "npx", "args": ["-y", "some-mcp-server", ...] }  use:
//   { "command": "node", "args": ["/path/to/tend-mcp-proxy.mjs", "--", "npx", "-y", "some-mcp-server", ...],
//     "env": { "TEND_URL": "http://localhost:3000", "TEND_AGENT_KEY": "tend_sk_..." } }
//
// In TEND each MCP tool is a tool name with the action "call", for example a rule  { tool: "read_file", action: "call", effect: "allow" }.
// The approval shows the arguments; it is bound to all of them through a hash in `resource`, so a person approves exactly what will run.
// What this cannot stop: a host configured to start the real server directly, or a server that is reachable some other way. See docs/connectivity.md.
// Transport: MCP stdio (newline-delimited JSON-RPC 2.0). No dependencies.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { connectTend } from "../claude-quickstart/tend-client.mjs";

const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const log = (m) => process.stderr.write(`[tend-mcp-proxy] ${m}\n`); // stdout belongs to the protocol

const sha = (text) => createHash("sha256").update(text).digest("hex");
/**
 * The arguments as TEND's rules see them (`when` conditions): the same structure, with long strings and long lists replaced by their hash
 * and length, so the request stays small. Too large or too deep even then: null, and rules with conditions do not match (they fail closed).
 */
export function summarize(args) {
  const walk = (v, depth) => {
    if (typeof v === "string") return v.length <= 256 ? v : { sha256: sha(v), length: v.length };
    if (Array.isArray(v)) return v.length <= 50 && depth < 4 ? v.map((x) => walk(x, depth + 1)) : { sha256: sha(JSON.stringify(v)), length: v.length };
    if (v && typeof v === "object") return depth < 4 ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, depth + 1)])) : { sha256: sha(JSON.stringify(v)) };
    return typeof v === "number" || typeof v === "boolean" || v === null ? v : String(v);
  };
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  const out = walk(args, 0);
  return JSON.stringify(out).length <= 3_500 ? out : null;
}

/** What TEND is asked for one tools/call: the tool, "call", a hash of the full arguments, the readable arguments (shortened if long) and their summary. */
export function toRequest(params) {
  const name = params?.name, args = params?.arguments ?? {};
  if (typeof name !== "string" || !ID.test(name)) return null;
  const text = JSON.stringify(args);
  const resource = `args:${sha(text).slice(0, 32)}`;
  const more = "… (shortened; bound to all arguments)"; // TEND accepts at most 200 characters of detail
  const detail = text.length <= 200 ? text : `${text.slice(0, 200 - more.length)}${more}`;
  const summary = summarize(args);
  return { tool: name, action: "call", resource, detail, ...(summary && Object.keys(summary).length && { args: summary }) };
}

/** A tool error the host shows to the model, so it can tell the user that the action did not happen. */
export const blocked = (id, why) => ({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Not done: TEND did not allow this tool call (${why}).` }], isError: true } });

export function startProxy({ command, args, gate, input = process.stdin, output = process.stdout, env = process.env }) {
  // The real server gets the environment minus TEND's settings: it never holds the agent's TEND key.
  const childEnv = Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith("TEND_")));
  const server = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"], env: childEnv });
  const send = (stream, msg) => stream.write(`${JSON.stringify(msg)}\n`);
  const pending = new Map(); // forwarded tools/call id -> resolve(response), so the result is known before it is reported
  server.on("exit", (code) => { log(`MCP server exited (${code})`); output.end?.(); });

  createInterface({ input: server.stdout }).on("line", (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return output.write(`${line}\n`); }
    if (msg && msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    output.write(`${line}\n`);
  });

  createInterface({ input }).on("line", async (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return server.stdin.write(`${line}\n`); }
    if (msg?.method !== "tools/call" || msg.id === undefined) return server.stdin.write(`${line}\n`);
    const req = toRequest(msg.params);
    if (!req) return send(output, blocked(msg.id, "tool name TEND cannot accept"));
    let response;
    const out = await gate.run(req, () => new Promise((resolve) => {
      pending.set(msg.id, resolve);
      server.stdin.write(`${line}\n`); // exactly what the host sent, once
    }).then((r) => { response = r; if (r.error || r.result?.isError) throw new Error("tool reported an error"); return "ok"; }));
    if (response) return send(output, response); // the server's own answer, whatever it was
    send(output, blocked(msg.id, `${out.outcome}${out.reason ? `: ${out.reason}` : ""}${out.detail ? `; ${out.detail}` : ""}`));
  }).on("close", () => server.stdin.end());
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await import("../real-agents/node-check.mjs");
  const sep = process.argv.indexOf("--");
  const [command, ...args] = sep > 0 ? process.argv.slice(sep + 1) : [];
  if (!command) {
    log('Usage: node tend-mcp-proxy.mjs -- <mcp server command> [args...]   (with TEND_URL and TEND_AGENT_KEY in the environment)');
    process.exit(2);
  }
  let gate;
  try {
    const timeout = Number(process.env.TEND_APPROVAL_TIMEOUT_MS ?? 120_000);
    gate = connectTend({ approvalTimeoutMs: timeout, onPending: () => log("waiting for a person to decide in TEND (Approvals, or: npm run tend -- pending)") });
  } catch (e) {
    log(e.message.split("\n")[0]);
    process.exit(2);
  }
  startProxy({ command, args, gate });
}
