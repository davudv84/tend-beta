// The MCP proxy (examples/mcp-proxy) against TEND's real authorization, approval and audit code served over HTTP, with a real child-process
// MCP server behind it and a scripted MCP client in front. What is NOT here: a real MCP host (Claude Desktop, Claude Code, Hermes Agent).
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { blocked, startProxy, toRequest } from "../../examples/mcp-proxy/tend-mcp-proxy.mjs";
import { connectTend } from "../../examples/claude-quickstart/tend-client.mjs";
import { authAgent } from "./agent-auth.ts";
import { authorizationStatus, claimToken, consumeAuthorization, requestAuthorization, spendApproved } from "./authz.ts";
import { memoryDb, type DB } from "./db.ts";
import { json, readJson, route } from "./http.ts";
import { decide, ingestEvents, registerAgent, revokeKey, setPolicy } from "./repo.ts";

/** TEND's own agent-side handlers behind a real HTTP port (the same functions the API routes call). */
function serve(db: DB) {
  const handle = route(async (req) => {
    const p = new URL(req.url).pathname;
    const agent = await authAgent(db, req);
    if (req.method === "POST" && p === "/api/v1/authorizations") {
      const { view, created } = await requestAuthorization(db, agent, await readJson(req), req.headers.get("idempotency-key"));
      return json(view, view.status === "denied" ? 403 : created ? 201 : 200);
    }
    if (req.method === "POST" && p === "/api/v1/authorize") {
      const { view } = await requestAuthorization(db, agent, await readJson(req), req.headers.get("idempotency-key"), Date.now(), { spend: true });
      return json({ ...view, authorized: view.status === "consumed" }, view.status === "consumed" ? 200 : view.status === "pending" ? 202 : view.status === "denied" ? 403 : 409);
    }
    const st = p.match(/^\/api\/v1\/authorizations\/([^/]+)$/);
    if (req.method === "GET" && st) return json(await authorizationStatus(db, agent, st[1]));
    const sp = p.match(/^\/api\/v1\/authorizations\/([^/]+)\/spend$/);
    if (req.method === "POST" && sp) return json(await spendApproved(db, agent, sp[1], await readJson(req)));
    const m = p.match(/^\/api\/v1\/authorizations\/([^/]+)\/(token|consume)$/);
    if (req.method === "POST" && m?.[2] === "token") { const { view } = await claimToken(db, agent, m[1]); return json(view, view.status === "pending" ? 202 : 200); }
    if (req.method === "POST" && m?.[2] === "consume") return json(await consumeAuthorization(db, agent, m[1], await readJson(req)));
    if (req.method === "POST" && p === "/api/v1/events") { const b = (await readJson(req)) as unknown; return json({ results: await ingestEvents(db, agent, [b]) }, 202); }
    return json({ error: "not_found" }, 404);
  });
  const server = createServer(async (nreq, nres) => {
    const chunks: Buffer[] = [];
    for await (const c of nreq) chunks.push(c as Buffer);
    const res = await handle(new Request(`http://127.0.0.1${nreq.url}`, { method: nreq.method, headers: nreq.headers as HeadersInit, body: nreq.method === "GET" ? undefined : Buffer.concat(chunks) }), undefined as never);
    nres.writeHead(res.status, Object.fromEntries(res.headers));
    nres.end(await res.text());
  });
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => new Promise((r) => server.close(() => r())) })));
}

/** A minimal MCP stdio server: answers initialize and tools/list, echoes tools/call, and writes every call (and any TEND_ variable it can see) to a log. */
const FAKE_SERVER = `
import { appendFileSync } from "node:fs"; import { createInterface } from "node:readline";
const log = process.argv[2];
appendFileSync(log, JSON.stringify({ env: Object.keys(process.env).filter((k) => k.startsWith("TEND_")) }) + "\\n");
createInterface({ input: process.stdin }).on("line", (l) => {
  const m = JSON.parse(l), out = (r) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, ...r }) + "\\n");
  if (m.method === "initialize") out({ result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } } });
  else if (m.method === "tools/list") out({ result: { tools: [{ name: "read_file", inputSchema: { type: "object" } }] } });
  else if (m.method === "tools/call") { appendFileSync(log, JSON.stringify({ call: m.params }) + "\\n"); out({ result: { content: [{ type: "text", text: "did " + m.params.name }] } }); }
});`;

async function setup(rules: unknown[], { tendUrl }: { tendUrl?: string } = {}) {
  const db = await memoryDb();
  const reg = await registerAgent(db, { name: "MCP agent", model: "m", provider: "Custom" });
  await setPolicy(db, reg.agent.id, rules, "enforce");
  const tend = await serve(db);
  const dir = mkdtempSync(path.join(tmpdir(), "tend-mcp-"));
  writeFileSync(path.join(dir, "server.mjs"), FAKE_SERVER);
  const logFile = path.join(dir, "calls.log");
  const input = new PassThrough(), output = new PassThrough();
  const gate = connectTend({ url: tendUrl ?? tend.url, key: reg.apiKey, retries: 0, pollMs: 40, approvalTimeoutMs: 4_000 });
  const child = startProxy({ command: process.execPath, args: [path.join(dir, "server.mjs"), logFile], gate, input, output, env: { ...process.env, TEND_AGENT_KEY: reg.apiKey, TEND_URL: tend.url } });
  const waiting = new Map<unknown, (m: Record<string, unknown>) => void>();
  let buf = "";
  output.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); const m = JSON.parse(line); waiting.get(m.id)?.(m); waiting.delete(m.id); } });
  let n = 0;
  const rpc = (method: string, params?: unknown) => new Promise<Record<string, unknown>>((resolve) => { const id = ++n; waiting.set(id, resolve); input.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`); });
  const lines = () => { try { return readFileSync(logFile, "utf8").trim().split("\n").map((l) => JSON.parse(l)); } catch { return []; } };
  const calls = () => lines().filter((l) => l.call).map((l) => l.call.name);
  const events = async (type: string) => (await db.all<{ data: string }>("SELECT data FROM events WHERE type = ?", type)).map((r) => JSON.parse(r.data));
  const close = async () => { input.end(); child.kill(); await tend.close(); await db.close(); rmSync(dir, { recursive: true, force: true }); };
  return { db, agentId: reg.agent.id, rpc, calls, lines, events, close };
}
const text = (m: Record<string, unknown>) => ((m.result as { content?: { text: string }[] })?.content ?? []).map((c) => c.text).join(" ");
const isError = (m: Record<string, unknown>) => (m.result as { isError?: boolean })?.isError === true;

test("everything but tools/call passes through untouched; the MCP server never receives TEND's key", async () => {
  const s = await setup([]);
  try {
    assert.equal(((await s.rpc("initialize", { protocolVersion: "2025-06-18" })).result as { serverInfo: { name: string } }).serverInfo.name, "fake");
    assert.equal(((await s.rpc("tools/list")).result as { tools: { name: string }[] }).tools[0].name, "read_file");
    assert.deepEqual(s.lines()[0].env, [], "no TEND_ variable reached the server process");
  } finally { await s.close(); }
});

test("allowed by policy: forwarded exactly once, the server's own answer comes back, and TEND records the decision and the run", async () => {
  const s = await setup([{ tool: "read_file", action: "call", effect: "allow" }]);
  try {
    const r = await s.rpc("tools/call", { name: "read_file", arguments: { path: "notes.txt" } });
    assert.equal(text(r), "did read_file");
    assert.deepEqual(s.calls(), ["read_file"]);
    const [ran] = await s.events("tool.called");
    assert.deepEqual([ran.tool, ran.action, ran.outcome], ["read_file", "call", "success"]);
    assert.ok(ran.authorizationId);
    assert.equal((await s.events("alert.raised")).length, 0, "the report matches what was authorized");
  } finally { await s.close(); }
});

test("denied by policy, or no rule at all: the server never sees the call and the agent is told why", async () => {
  const s = await setup([{ tool: "delete_file", action: "call", effect: "deny" }]);
  try {
    const d = await s.rpc("tools/call", { name: "delete_file", arguments: { path: "notes.txt" } });
    assert.ok(isError(d) && /policy_denied/.test(text(d)), text(d));
    const u = await s.rpc("tools/call", { name: "format_disk", arguments: {} });
    assert.ok(isError(u) && /no_policy/.test(text(u)), text(u));
    assert.deepEqual(s.calls(), [], "nothing reached the MCP server");
  } finally { await s.close(); }
});

test("needs approval: held until a person approves, then forwarded once; a rejection means never", async () => {
  const s = await setup([{ tool: "send_email", action: "call", effect: "approve" }]);
  try {
    const pendingId = async () => { for (;;) { const r = await s.db.get<{ id: string }>("SELECT id FROM authorizations WHERE status = 'pending' LIMIT 1"); if (r) return r.id; await new Promise((x) => setTimeout(x, 20)); } };
    const ok = s.rpc("tools/call", { name: "send_email", arguments: { to: "team-1" } });
    const id1 = await pendingId();
    assert.deepEqual(s.calls(), [], "nothing ran while it waited");
    await decide(s.db, id1, "approved");
    assert.equal(text(await ok), "did send_email");
    const no = s.rpc("tools/call", { name: "send_email", arguments: { to: "team-2" } });
    await decide(s.db, await pendingId(), "rejected");
    const r = await no;
    assert.ok(isError(r) && /rejected/.test(text(r)), text(r));
    assert.deepEqual(s.calls(), ["send_email"], "exactly one call reached the server");
  } finally { await s.close(); }
});

test("revoking the agent's key while a call waits stops it, and every later call", async () => {
  const s = await setup([{ tool: "send_email", action: "call", effect: "approve" }, { tool: "read_file", action: "call", effect: "allow" }]);
  try {
    const waiting = s.rpc("tools/call", { name: "send_email", arguments: { to: "team-3" } });
    for (;;) { if (await s.db.get("SELECT 1 FROM authorizations WHERE status = 'pending'")) break; await new Promise((x) => setTimeout(x, 20)); }
    await revokeKey(s.db, s.agentId);
    assert.ok(isError(await waiting));
    const later = await s.rpc("tools/call", { name: "read_file", arguments: { path: "a" } });
    assert.ok(isError(later) && /invalid_key|does not accept/.test(text(later)), text(later));
    assert.deepEqual(s.calls(), []);
  } finally { await s.close(); }
});

test("a call with long arguments is accepted by TEND (the shortened text stays within its limit) and runs once allowed", async () => {
  const s = await setup([{ tool: "read_file", action: "call", effect: "allow" }]);
  try {
    assert.equal(text(await s.rpc("tools/call", { name: "read_file", arguments: { path: "notes.txt", note: "z".repeat(1000) } })), "did read_file");
    assert.deepEqual(s.calls(), ["read_file"]);
  } finally { await s.close(); }
});

test("TEND unreachable: the call is refused (fail closed) and the server never sees it", async () => {
  const s = await setup([{ tool: "read_file", action: "call", effect: "allow" }], { tendUrl: "http://127.0.0.1:1" });
  try {
    const r = await s.rpc("tools/call", { name: "read_file", arguments: { path: "a" } });
    assert.ok(isError(r) && /unavailable/.test(text(r)), text(r));
    assert.deepEqual(s.calls(), []);
  } finally { await s.close(); }
});

test("an approval is bound to the exact arguments: a hash of all of them, even when the readable part is shortened", () => {
  const a = toRequest({ name: "send_email", arguments: { to: "team-1", body: "x".repeat(500) } })!;
  const b = toRequest({ name: "send_email", arguments: { to: "team-1", body: `${"x".repeat(499)}y` } })!;
  assert.match(a.resource, /^args:[0-9a-f]{32}$/);
  assert.notEqual(a.resource, b.resource, "a change anywhere in the arguments is a different request");
  assert.ok(a.detail.length <= 200 && /shortened/.test(a.detail), `detail is ${a.detail.length} characters`);
  assert.equal(toRequest({ name: "bad name!", arguments: {} }), null, "a tool name TEND cannot accept is refused");
  assert.equal(toRequest({ arguments: {} }), null);
  assert.equal((blocked(7, "x").result as { isError: boolean }).isError, true);
});
