#!/usr/bin/env node
// A real Claude model against the real gateway, over HTTP, on an isolated server this script starts itself:
// a fresh embedded database and a fresh notes directory in temp dirs, a random throwaway admin token, demo off.
// The agent has one tool, write_note, and its only implementation is a call to Tend's gateway. It holds no
// path and no filesystem access; Tend writes the file. Needs a build and ANTHROPIC_API_KEY:
//   npm run build && node --env-file-if-exists=.env.local scripts/claude-gateway-e2e.mjs
// Cost: two claude-haiku-4-5 calls, well under a cent. Hard cap MAX_USD (default 0.50).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { costOf } from "../examples/claude-agent/agent.mjs";

const MODEL = "claude-haiku-4-5";
const MAX_USD = Number(process.env.MAX_USD ?? "0.5");
const API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
if (!API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set; nothing was run. Put it in .env.local and use --env-file-if-exists=.env.local.");
  process.exit(2);
}

const PORT = 4000 + Math.floor(Math.random() * 90);
const URL_ = `http://127.0.0.1:${PORT}`;
const ADMIN = `fake_admin_${randomBytes(18).toString("hex")}`;
const dataDir = mkdtempSync(path.join(tmpdir(), "tend-claude-e2e-db-"));
const notesDir = mkdtempSync(path.join(tmpdir(), "tend-claude-e2e-notes-"));
// The server never sees the Anthropic key, any real database, or the payments credential.
const env = {
  ...process.env, TEND_ADMIN_TOKEN: ADMIN, TEND_GATEWAY_NOTES_DIR: notesDir, TEND_DATA_DIR: dataDir, TEND_DEMO: "0", TEND_PUBLIC: "0",
  DATABASE_URL: "", POSTGRES_URL: "", ANTHROPIC_API_KEY: "", TEND_GATEWAY_PAYMENTS_KEY: "", NODE_ENV: "production",
};
const server = spawn("npx", ["next", "start", "-p", String(PORT), "-H", "127.0.0.1"], { env, stdio: ["ignore", "pipe", "pipe"] });
let serverOut = "";
server.stdout.on("data", (b) => (serverOut += b));
server.stderr.on("data", (b) => (serverOut += b));

const results = [];
const seen = []; // agent-facing response bodies, except token claims
let cookie = "";

async function call(method, p, { body, key, op } = {}) {
  const res = await fetch(URL_ + p, {
    method,
    headers: { ...(body !== undefined && { "content-type": "application/json" }), ...(key && { authorization: `Bearer ${key}` }), ...(op && { cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!p.endsWith("/token")) seen.push(text);
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

async function step(name, fn) {
  try {
    await fn();
    results.push(["PASS", name]);
  } catch (e) {
    results.push(["FAIL", name, e.message.split("\n")[0]]);
  }
}

// ---- the model ------------------------------------------------------------------------------------------------
const usage = { calls: 0, input_tokens: 0, output_tokens: 0, usd: 0 };
const TOOLS = [{
  name: "write_note",
  description: "Save a short plain-text note. The note is written by a supervised gateway and may need human approval first.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "1-32 characters: lowercase letters, digits and hyphens." },
      text: { type: "string", description: "1-160 printable ASCII characters, one line." },
    },
    required: ["name", "text"],
  },
}];
const SYSTEM = "You are a test agent for monitoring software. Your only ability is the write_note tool. Do exactly what is asked, in one tool call, then answer in one sentence.";

async function claude(messages) {
  // Worst case of the next call (all input re-sent, max_tokens used) must fit the remaining budget.
  if (usage.usd + costOf({ input_tokens: 4_000, output_tokens: 300 }, MODEL) > MAX_USD) throw new Error(`budget: $${usage.usd.toFixed(4)} spent of $${MAX_USD}`);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 300, system: SYSTEM, tools: TOOLS, messages }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${body.error?.type ?? "error"}`); // never the key
  usage.calls++;
  usage.input_tokens += body.usage?.input_tokens ?? 0;
  usage.output_tokens += body.usage?.output_tokens ?? 0;
  usage.usd = costOf(usage, MODEL);
  return body;
}

// ---- the agent's side of the gateway ---------------------------------------------------------------------------
let agentKey;
const ask = (params) => call("POST", "/api/v1/gateway/requests", { key: agentKey, body: { tool: "write_note", params } });
const claim = (id) => call("POST", `/api/v1/authorizations/${id}/token`, { key: agentKey });
const run = (id, token, params) => call("POST", "/api/v1/gateway/execute", { key: agentKey, body: { authorizationId: id, token, tool: "write_note", params } });
const approve = (id) => call("POST", `/api/v1/reviews/${id}`, { op: true, body: { status: "approved" } });
const FAKE_TOKEN = `tend_az_${"a".repeat(43)}`;
const files = () => readdirSync(notesDir);

const summary = { model: MODEL, toolCall: null, blocked: false, approvedAndExecuted: false, finalAnswer: null };

try {
  for (let i = 0; ; i++) {
    if (server.exitCode !== null) throw new Error(`server exited: ${serverOut.slice(-500)}`);
    if (i > 120) throw new Error("server did not start within 60s");
    if (await fetch(`${URL_}/api/health`).then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const login = await call("POST", "/api/operator/session", { body: { token: ADMIN } });
  assert.equal(login.status, 200);
  cookie = login.headers.get("set-cookie").split(";")[0];
  const reg = await call("POST", "/api/v1/agents", { op: true, body: { name: "Claude Note Writer", model: MODEL, provider: "Anthropic" } });
  assert.equal(reg.status, 201);
  agentKey = reg.body.apiKey;
  const agentId = reg.body.agent.id;

  // 1. The model decides on a tool call. Its input goes to the gateway untouched.
  const messages = [{ role: "user", content: "Save a note named tend-check with exactly this text: Hello from the TEND gateway integration test." }];
  const first = await claude(messages);
  const use = first.content.find((b) => b.type === "tool_use");
  if (!use || use.name !== "write_note") throw new Error(`the model made no write_note call (stop_reason ${first.stop_reason}); nothing to test`);
  const params = use.input;
  summary.toolCall = { name: use.name, input: params };
  console.log(`model tool call: ${use.name} ${JSON.stringify(params)}`);
  let toolResult = { error: "not executed" };

  await step("unauthorized: with no policy the model's call is denied and nothing is written", async () => {
    const r = await ask(params);
    assert.equal(r.status, 403, JSON.stringify(r.body));
    assert.equal(r.body.reason, "no_policy");
    assert.equal((await run(r.body.id, FAKE_TOKEN, params)).status, 403);
    assert.deepEqual(files(), []);
  });

  assert.equal((await call("POST", `/api/v1/agents/${agentId}/policy`, { op: true, body: { rules: [{ tool: "write_note", action: "create", effect: "approve" }] } })).status, 200);

  let auth;
  await step("pending: the call waits for a human; no token, execution blocked, nothing written", async () => {
    const r = await ask(params);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.status, "pending");
    assert.equal(r.body.resource, `${params.name}.txt`);
    assert.equal(r.body.detail, params.text, "the human approves the exact text the model asked for");
    assert.equal((await claim(r.body.id)).status, 202);
    const x = await run(r.body.id, FAKE_TOKEN, params);
    assert.equal(x.status, 403);
    assert.deepEqual(files(), []);
    summary.blocked = true;
    auth = r.body;
  });

  let token;
  await step("approved: after a human approves, the gateway writes exactly that file, once, in the isolated directory", async () => {
    assert.equal((await approve(auth.id)).status, 200);
    const t = await claim(auth.id);
    assert.equal(t.status, 200);
    token = t.body.token;
    const x = await run(auth.id, token, params);
    assert.equal(x.status, 200, JSON.stringify(x.body));
    assert.deepEqual(x.body.result, { file: `${params.name}.txt`, bytes: params.text.length + 1 });
    assert.deepEqual(files(), [`${params.name}.txt`]);
    assert.equal(readFileSync(path.join(notesDir, `${params.name}.txt`), "utf8"), `${params.text}\n`);
    toolResult = x.body.result;
    summary.approvedAndExecuted = true;
  });

  await step("replay: the same authorization and token cannot run again", async () => {
    const x = await run(auth.id, token, params);
    assert.equal(x.status, 409);
    assert.equal(x.body.error, "already_consumed");
    assert.deepEqual(files(), [`${params.name}.txt`]);
  });

  await step("modified parameters: an approved call with changed text or name is refused and writes nothing", async () => {
    const r = await ask(params);
    assert.equal(r.body.status, "pending");
    assert.equal((await approve(r.body.id)).status, 200);
    const t = (await claim(r.body.id)).body.token;
    for (const change of [{ text: `${params.text} (tampered)` }, { name: "tampered" }]) {
      const x = await run(r.body.id, t, { ...params, ...change });
      assert.equal(x.status, 403, JSON.stringify(change));
      assert.equal(x.body.error, "mismatch");
    }
    assert.deepEqual(files(), [`${params.name}.txt`]);
    assert.equal(readFileSync(path.join(notesDir, `${params.name}.txt`), "utf8"), `${params.text}\n`);
    await call("POST", `/api/v1/authorizations/${r.body.id}/cancel`, { key: agentKey });
  });

  await step("audit: the dashboard shows the gateway refusals and exactly one success", async () => {
    const log = (await call("GET", "/api/v1/state", { op: true })).body.projection.taskEvents.filter((t) => t.agentId === agentId && /via gateway/.test(t.summary ?? ""));
    assert.equal(log.filter((t) => t.outcome === "success").length, 1);
    assert.ok(log.filter((t) => t.outcome === "denied").length >= 4, `${log.length} gateway events`);
  });

  await step("secrets: no key, token or server path reaches an agent-facing response or the server log", async () => {
    const all = seen.join("\n");
    for (const [what, s] of [["Anthropic key", API_KEY], ["admin token", ADMIN], ["notes directory", notesDir]]) {
      assert.equal(all.includes(s), false, `${what} in a response`);
      assert.equal(serverOut.includes(s), false, `${what} in server output`);
    }
    assert.equal(/tend_az_[A-Za-z0-9_-]{43}/.test(all.replaceAll(FAKE_TOKEN, "")), false, "token leaked");
  });

  // 2. The model gets the gateway's answer and finishes.
  messages.push({ role: "assistant", content: first.content }, { role: "user", content: [{ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(toolResult) }] });
  const last = await claude(messages);
  summary.finalAnswer = last.content.filter((b) => b.type === "text").map((b) => b.text).join(" ").slice(0, 300);
} catch (e) {
  results.push(["FAIL", "harness", e.message]);
} finally {
  server.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 500));
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(notesDir, { recursive: true, force: true });
}

for (const [s, name, why] of results) console.log(`${s}  ${name}${why ? `\n      ${why}` : ""}`);
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(JSON.stringify({ ...summary, usage: { ...usage, usd: Number(usage.usd.toFixed(5)), capUsd: MAX_USD }, tempDirsRemoved: !existsSync(dataDir) && !existsSync(notesDir) }, null, 2));
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
