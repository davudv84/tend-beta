// The MCP proxy (examples/mcp-proxy/tend-mcp-proxy.mjs) speaking real MCP stdio JSON-RPC in front of the example notes server, against a throwaway TEND.
// The notes server writes one ledger line per tool that REALLY ran, so "blocked" means the real server never saw the call.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { startIsolatedServer } from "../../scripts/isolated-server.mjs";
import { record } from "./lib.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const work = mkdtempSync(path.join(tmpdir(), "tend-mcp-"));
const ledger = path.join(work, "ledger.jsonl");
const ADMIN = `rt_admin_${randomBytes(24).toString("hex")}`;
const server = await startIsolatedServer({ root, env: { TEND_ADMIN_TOKEN: ADMIN, TEND_DATA_DIR: path.join(work, "data") } });
const api = async (m, p, { body, cookie } = {}) => { const r = await fetch(server.url + p, { method: m, headers: { ...(body && { "content-type": "application/json" }), ...(cookie && { cookie }) }, body: body && JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null), cookie: r.headers.get("set-cookie")?.split(";")[0] }; };
const ran = () => (existsSync(ledger) ? readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
let proxy;
try {
  const cookie = (await api("POST", "/api/operator/session", { body: { token: ADMIN } })).cookie;
  const reg = (await api("POST", "/api/v1/agents", { cookie, body: { name: "MCP probe", model: "m", provider: "Custom" } })).body;
  await api("POST", `/api/v1/agents/${reg.agent.id}/policy`, { cookie, body: { enforcement: "enforce", rules: [{ tool: "read_note", action: "call", effect: "allow" }, { tool: "delete_note", action: "call", effect: "deny" }, { tool: "send_note", action: "call", effect: "approve" }] } });
  proxy = spawn(process.execPath, [path.join(root, "examples/mcp-proxy/tend-mcp-proxy.mjs"), "--", process.execPath, path.join(root, "examples/mcp-proxy/notes-server.mjs"), ledger], { env: { PATH: process.env.PATH, TEND_URL: server.url, TEND_AGENT_KEY: reg.apiKey }, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map(); let nextId = 1;
  createInterface({ input: proxy.stdout }).on("line", (l) => { try { const m = JSON.parse(l); pending.get(m.id)?.(m); } catch {} });
  const rpc = (method, params, timeout = 30_000) => new Promise((resolve) => { const id = nextId++; const t = setTimeout(() => resolve({ timeout: true }), timeout); pending.set(id, (m) => { clearTimeout(t); resolve(m); }); proxy.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
  const call = (name, args, timeout) => rpc("tools/call", { name, arguments: args }, timeout);
  const text = (m) => JSON.stringify(m.result ?? m.error ?? m);
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "rt", version: "1" } });
  const list = await rpc("tools/list", {});
  record("MCP-0", "control", "tools/list passes through", (list.result?.tools ?? []).length === 3 ? "HELD" : "BROKEN", text(list).slice(0, 100));
  const r1 = await call("read_note", { id: "N-1" });
  record("MCP-1", "allow", "allowed tool runs (and the server really ran it once)", /Buy oat milk/.test(text(r1)) && ran().filter((x) => x.tool === "read_note").length === 1 ? "HELD" : "BROKEN", text(r1).slice(0, 100));
  const r2 = await call("delete_note", { id: "N-1" });
  record("MCP-2", "deny", "denied tool: the real server never sees the call", ran().every((x) => x.tool !== "delete_note") && (r2.result?.isError || r2.error) ? "HELD" : "BROKEN", text(r2).slice(0, 140));
  for (const [i, name] of ["Delete_Note", "delete_note ", "delete_note​", "DELETE_NOTE", "tools/../delete_note", "unknown_tool"].entries()) {
    const r = await call(name, { id: "N-2" });
    record(`MCP-3${i}`, "bypass", `tool name variant ${JSON.stringify(name)} cannot reach delete_note`, ran().every((x) => x.tool !== "delete_note") ? "HELD" : "BROKEN", text(r).slice(0, 100));
  }
  const r3 = await call("unlisted_tool_with_args", { id: { $ne: 1 }, __proto__: { x: 1 } });
  record("MCP-4", "bypass", "a tool with no rule is denied (default deny), nothing runs", ran().length === 1 && (r3.result?.isError || r3.error) ? "HELD" : "BROKEN", text(r3).slice(0, 100));
  // approval: the proxy waits for a person; approve a DIFFERENT argument set later: must not run
  const waiting = call("send_note", { id: "N-1", to: "team-1" }, 40_000);
  await new Promise((r) => setTimeout(r, 3000));
  const st = (await api("GET", "/api/v1/state", { cookie })).body;
  const req = (st?.projection?.authorizations ?? Object.values(st?.projection?.authorizationsById ?? {}) ?? []).find?.((a) => a.tool === "send_note" && a.status === "pending");
  let reviewId = req?.id;
  if (!reviewId) { const ev = (await api("GET", "/api/v1/events?since=0", { cookie })).body?.events ?? []; reviewId = ev.filter((e) => e.type === "authorization.requested" && e.data?.tool === "send_note").at(-1)?.data?.authorizationId; }
  const dec = await api("POST", `/api/v1/reviews/${reviewId}`, { cookie, body: { status: "approved" } });
  const done = await waiting;
  const sent = ran().filter((x) => x.tool === "send_note");
  record("MCP-5", "approval", "approval-gated tool waits for a person, then runs exactly once with exactly the approved arguments", dec.status === 200 && sent.length === 1 && sent[0].args.to === "team-1" && !/isError":true/.test(text(done)) ? "HELD" : "BROKEN", `decide=${dec.status} ran=${JSON.stringify(sent)}`);
  const again = await call("send_note", { id: "N-1", to: "team-1" }, 8_000);
  record("MCP-6", "reuse", "the same call again is not covered by the earlier approval (asks again, does not run)", ran().filter((x) => x.tool === "send_note").length === 1 ? "HELD" : "BROKEN", text(again).slice(0, 80));
  proxy.kill();
  await server.stop();
  const dead = spawn(process.execPath, [path.join(root, "examples/mcp-proxy/tend-mcp-proxy.mjs"), "--", process.execPath, path.join(root, "examples/mcp-proxy/notes-server.mjs"), ledger], { env: { PATH: process.env.PATH, TEND_URL: server.url, TEND_AGENT_KEY: reg.apiKey }, stdio: ["pipe", "pipe", "pipe"] });
  const before = ran().length; const out = [];
  createInterface({ input: dead.stdout }).on("line", (l) => out.push(l));
  dead.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "rt", version: "1" } } }) + "\n");
  await new Promise((r) => setTimeout(r, 1500));
  dead.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "read_note", arguments: { id: "N-1" } } }) + "\n");
  await new Promise((r) => setTimeout(r, 6000)); dead.kill();
  record("MCP-7", "fail-closed", "TEND is down: even an allow-listed tool is not forwarded", ran().length === before ? "HELD" : "BROKEN", out.slice(-1)[0]?.slice(0, 120) ?? "(no answer)");
} finally { proxy?.kill(); await server.stop().catch(() => {}); }
