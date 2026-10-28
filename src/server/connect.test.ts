// The five-minute onboarding path: the harmless test tool goes through the real gateway, and the exact script the dashboard
// hands to a new user works end to end, against real Tend code over real HTTP, with a person (here, decide()) in the loop.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { test } from "node:test";
import { TEST_SCRIPT, connectCommand, maskedCommand } from "../lib/connect-snippet.ts";
import { agentByKey, decide, inbox, registerAgent, setPolicy } from "./repo.ts";
import { authAgent } from "./agent-auth.ts";
import { claimToken } from "./authz.ts";
import { memoryDb, type DB } from "./db.ts";
import { executeTool, requestExecution } from "./gateway.ts";
import { json, readJson, route } from "./http.ts";

const PING = { message: "hello from my agent" };
const rule = (effect: string) => [{ tool: "test_ping", action: "ping", effect }];

async function setup(effect?: string) {
  const db = await memoryDb();
  const { agent, apiKey } = await registerAgent(db, { name: "Newcomer", model: "m", provider: "Custom" });
  if (effect) await setPolicy(db, agent.id, rule(effect), "enforce");
  return { db, id: agent.id, key: apiKey };
}

// ---- the tool, through the gateway --------------------------------------------------------------------------------

test("the test action is blocked until a rule allows it, and the approval shows exactly what will run", async () => {
  const none = await setup();
  const asked = await setup("approve");
  try {
    const agent = (await agentByKey(none.db, none.key))!;
    const denied = (await requestExecution(none.db, agent, { tool: "test_ping", params: PING }, null)).view;
    assert.deepEqual([denied.status, denied.reason], ["denied", "no_policy"]);

    const a2 = (await agentByKey(asked.db, asked.key))!;
    const { view } = await requestExecution(asked.db, a2, { tool: "test_ping", params: PING }, null);
    assert.deepEqual([view.status, view.tool, view.action, view.resource, view.detail], ["pending", "test_ping", "ping", "test", "Say: hello from my agent"]);
  } finally {
    await none.db.close();
    await asked.db.close();
  }
});

test("test action parameters are strict, and only the allowlisted answer comes back", async () => {
  const s = await setup("approve");
  try {
    const agent = (await agentByKey(s.db, s.key))!;
    for (const params of [{}, { message: "" }, { message: "x".repeat(41) }, { message: "no; rm -rf" }, { message: "ok", extra: 1 }, { message: 5 }, "hi", null])
      await assert.rejects(requestExecution(s.db, agent, { tool: "test_ping", params }, null), (e: { code?: string }) => e.code === "invalid_params", JSON.stringify(params));

    const { view } = await requestExecution(s.db, agent, { tool: "test_ping", params: PING }, null);
    await decide(s.db, view.id, "approved");
    const { view: claimed } = await claimToken(s.db, agent, view.id);
    if (!("token" in claimed)) throw new Error("expected a token");
    const body = { authorizationId: view.id, token: claimed.token, tool: "test_ping", params: PING };
    const ran = await executeTool(s.db, agent, body);
    assert.deepEqual(ran.result, { reply: "pong: hello from my agent" });
    await assert.rejects(executeTool(s.db, agent, body), (e: { code?: string }) => e.code === "already_consumed", "single use");
  } finally {
    await s.db.close();
  }
});

// ---- the script the dashboard shows, run for real ------------------------------------------------------------------

/** Tend's own request handlers behind a real HTTP port, so the script talks HTTP exactly as it would to the real server. */
function serve(db: DB) {
  const handle = route(async (req) => {
    const path = new URL(req.url).pathname;
    const agent = await authAgent(db, req);
    if (req.method === "GET" && path === "/api/v1/agent/inbox") return json({ agentId: agent.id, ...(await inbox(db, agent)) });
    if (req.method === "POST" && path === "/api/v1/gateway/requests") {
      const { view, created } = await requestExecution(db, agent, await readJson(req, 4_096), req.headers.get("idempotency-key"));
      return json(view, view.status === "denied" ? 403 : created ? 201 : 200);
    }
    const token = path.match(/^\/api\/v1\/authorizations\/([^/]+)\/token$/);
    if (req.method === "POST" && token) {
      const { view } = await claimToken(db, agent, token[1]);
      return json(view, view.status === "pending" ? 202 : 200);
    }
    if (req.method === "POST" && path === "/api/v1/gateway/execute") return json(await executeTool(db, agent, await readJson(req, 4_096)));
    return json({ error: "not_found" }, 404);
  });
  const server = createServer(async (nreq, nres) => {
    const chunks: Buffer[] = [];
    for await (const c of nreq) chunks.push(c as Buffer);
    const body = ["GET", "HEAD"].includes(nreq.method!) ? undefined : Buffer.concat(chunks);
    const res = await handle(new Request(`http://127.0.0.1${nreq.url}`, { method: nreq.method, headers: nreq.headers as HeadersInit, body }), undefined as never);
    nres.writeHead(res.status, Object.fromEntries(res.headers));
    nres.end(await res.text());
  });
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => new Promise((r) => server.close(() => r())) })));
}

/** Runs the dashboard's script as a separate process with a clean environment: nothing of the server's is visible to it. */
function runScript(url: string, key: string) {
  return new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module"], { env: { PATH: process.env.PATH ?? "", TEND_URL: url, TEND_AGENT_KEY: key, TEND_POLL_MS: "20" } as unknown as NodeJS.ProcessEnv }); // only these variables, on purpose: Next's typings make NODE_ENV mandatory in the type
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => resolve({ code, out, err }));
    child.stdin.end(TEST_SCRIPT);
  });
}

/** Stands in for the person at the dashboard: waits for the real pending request, then decides it. */
async function decideWhenPending(db: DB, status: "approved" | "rejected") {
  for (let i = 0; i < 400; i++) {
    const row = await db.get<{ id: string }>("SELECT id FROM authorizations WHERE status = 'pending' AND tool = 'test_ping'");
    if (row) return void (await decide(db, row.id, status));
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("no request ever reached the dashboard");
}
const rows = (db: DB, sql: string) => db.all<{ type: string; data: string }>(sql).then((r) => r.map((e) => ({ type: e.type, data: JSON.parse(e.data) as Record<string, unknown> })));

test("the script: connects, waits for a person, and Tend runs the action once after approval", async () => {
  const s = await setup("approve");
  const srv = await serve(s.db);
  try {
    const [run] = await Promise.all([runScript(srv.url, s.key), decideWhenPending(s.db, "approved")]);
    assert.equal(run.code, 0, run.err);
    assert.match(run.out, /Connected to Tend as "newcomer"/);
    assert.match(run.out, /Waiting for you to approve/);
    assert.match(run.out, /answered: pong: hello from my agent/);
    assert.equal(`${run.out}${run.err}`.includes(s.key), false, "the key is never printed");
    assert.equal(/tend_az_/.test(`${run.out}${run.err}`), false, "the token is never printed");

    const agent = (await s.db.get<{ last_seen_at: number | null }>("SELECT last_seen_at FROM agents WHERE id = ?", s.id))!;
    assert.ok(agent.last_seen_at, "the connection is recorded because a call really arrived with the key");
    const az = (await s.db.get<{ status: string }>("SELECT status FROM authorizations WHERE tool = 'test_ping'"))!;
    assert.equal(az.status, "consumed");
    const calls = await rows(s.db, "SELECT type, data FROM events WHERE type = 'tool.called'");
    assert.deepEqual(calls.map((c) => [c.data.tool, c.data.outcome, c.data.via]), [["test_ping", "success", "gateway"]]);
    assert.equal(JSON.stringify(calls).includes("pong"), false, "tool output is not stored in events");
  } finally {
    await srv.close();
    await s.db.close();
  }
});

test("the script: a rejection means nothing runs", async () => {
  const s = await setup("approve");
  const srv = await serve(s.db);
  try {
    const [run] = await Promise.all([runScript(srv.url, s.key), decideWhenPending(s.db, "rejected")]);
    assert.equal(run.code, 3);
    assert.match(run.err, /Not approved \(rejected\)\. Nothing was run\./);
    assert.equal(/pong/.test(run.out), false);
    assert.equal((await rows(s.db, "SELECT type, data FROM events WHERE type = 'tool.called'")).length, 0);
    assert.equal((await s.db.get<{ status: string }>("SELECT status FROM authorizations WHERE tool = 'test_ping'"))!.status, "rejected");
  } finally {
    await srv.close();
    await s.db.close();
  }
});

test("the script: with no permission set the action is denied by default and nothing runs", async () => {
  const s = await setup();
  const srv = await serve(s.db);
  try {
    const run = await runScript(srv.url, s.key);
    assert.equal(run.code, 2);
    assert.match(run.err, /blocked the test action \(no_policy\)/);
    assert.equal((await s.db.get<{ status: string }>("SELECT status FROM authorizations WHERE tool = 'test_ping'"))!.status, "denied");
    assert.equal((await rows(s.db, "SELECT type, data FROM events WHERE type = 'tool.called' AND (data::jsonb)->>'outcome' = 'success'")).length, 0);
  } finally {
    await srv.close();
    await s.db.close();
  }
});

test("the script: a wrong key is not a connection", async () => {
  const s = await setup("approve");
  const srv = await serve(s.db);
  try {
    const run = await runScript(srv.url, `tend_sk_${"A".repeat(32)}`);
    assert.equal(run.code, 1);
    assert.match(run.err, /Could not connect to Tend \(401/);
    assert.equal((await s.db.get<{ last_seen_at: number | null }>("SELECT last_seen_at FROM agents WHERE id = ?", s.id))!.last_seen_at, null, "no connection is recorded");
  } finally {
    await srv.close();
    await s.db.close();
  }
});

test("the copyable command embeds the script and only accepts a plain address and a real-looking key", () => {
  const key = `tend_sk_${"A".repeat(32)}`;
  const cmd = connectCommand("https://tend.example.com", key);
  assert.ok(cmd.startsWith(`TEND_URL=https://tend.example.com TEND_AGENT_KEY=${key} node --input-type=module <<'TEND_TEST'`));
  assert.ok(cmd.includes(TEST_SCRIPT) && cmd.endsWith("\nTEND_TEST"));
  assert.equal(maskedCommand("https://tend.example.com").includes("tend_sk_••••••••"), true);
  assert.equal(/tend_sk_x/.test(maskedCommand("https://tend.example.com")), false);
  for (const bad of ["https://x.com; rm -rf /", "ftp://x.com", "https://x.com/path", "javascript:alert(1)", "https://x.com'"]) assert.throws(() => connectCommand(bad, key), /address/, bad);
  for (const bad of ["tend_sk_short", "tend_sk_AAAAAAAAAAAAAAAAAAAAAAAAAAA; ls", "x"]) assert.throws(() => connectCommand("https://x.com", bad), /key/, bad);
});
