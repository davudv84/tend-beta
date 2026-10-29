// Approver identity, policy history, outcome-recording retries and append-only events. In-memory Postgres (PGlite);
// the same append-only and identity checks run against real PostgreSQL in postgres.test.ts.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { claimToken, requestAuthorization } from "./authz.ts";
import { sessionCookieName } from "./session.ts";
import { signedIn } from "./test-support.ts";
import { allowEventRemoval, memoryDb, type DB } from "./db.ts";
import { advanceDemo, resetDemo, seedDemo } from "./demo.ts";
import { executeTool, requestExecution } from "./gateway.ts";
import { requireOperator } from "./http.ts";
import { control, decide, getAgent, insertEvent, registerAgent, requestCheckIn, rotateKey, setPolicy } from "./repo.ts";

process.env.TEND_ADMIN_TOKEN = "test-admin-token-0123456789abcdef";
process.env.TEND_DEMO = "1";

const req = (cookie?: string, headers: Record<string, string> = {}) =>
  new Request("http://tend.test/api/v1/x", { method: "POST", headers: { host: "tend.test", ...(cookie && { cookie: `${sessionCookieName()}=${cookie}` }), ...headers } });
const failure = async (fn: () => unknown) => {
  try {
    await fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return "ok";
};
const sqlState = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return "ok";
};
const events = async (db: DB, agentId: string, type?: string) =>
  (await db.all<{ type: string; data: string }>("SELECT type, data FROM events WHERE agent_id = ? ORDER BY seq", agentId))
    .filter((e) => !type || e.type === type).map((e) => ({ type: e.type, data: JSON.parse(e.data) as Record<string, unknown> }));

test("requireOperator returns the session and refuses everything else", async () => {
  const db = await memoryDb();
  try {
    const me = await signedIn(db);
    assert.equal((await requireOperator(me.request(), db)).id, me.id);
    assert.equal((await requireOperator(me.request({ origin: "http://tend.test" }), db)).id, me.id);
    assert.equal(await failure(() => requireOperator(req(), db)), "operator_required");
    assert.equal(await failure(() => requireOperator(req(`${Date.now() + 1000}.0123456789abcdef.forged`), db)), "operator_required");
    assert.equal(await failure(() => requireOperator(me.request({ origin: "http://evil.test" }), db)), "bad_origin", "a valid session from another site is refused");
    assert.equal(await failure(() => requireOperator(me.request({ origin: "not a url" }), db)), "bad_origin");
  } finally {
    await db.close();
  }
});

test("every operator action records who did it, and a policy change records the whole policy", async () => {
  const db = await memoryDb();
  try {
    const by = "0123456789abcdef";
    const { agent } = await registerAgent(db, { name: "Clerk", model: "m", provider: "Anthropic" }, by);
    const rules = [{ tool: "t", action: "a", effect: "approve" }, { tool: "u", action: "*", resourcePrefix: "x", effect: "deny" }];
    await setPolicy(db, agent.id, rules, "enforce", by);
    const a = (await getAgent(db, agent.id))!;
    const { view } = await requestAuthorization(db, a, { tool: "t", action: "a" }, null);
    await decide(db, view.id, "approved", "ok", by);
    await control(db, agent.id, "pause", undefined, by);
    await requestCheckIn(db, agent.id, by).catch(() => {}); // paused agents refuse; resume first
    await control(db, agent.id, "resume", undefined, by);
    await requestCheckIn(db, agent.id, by);
    await rotateKey(db, agent.id, by);

    for (const type of ["agent.registered", "policy.updated", "review.decided", "agent.paused", "agent.resumed", "checkin.requested", "key.rotated"])
      assert.deepEqual((await events(db, agent.id, type)).map((e) => e.data.by), [by], `${type} records the session id`);
    const policy = (await events(db, agent.id, "policy.updated"))[0].data;
    assert.deepEqual(policy.policy, rules);
    assert.equal(policy.rules, 2);
    assert.equal(policy.enforcement, "enforce");
    assert.equal((await events(db, agent.id, "review.decided"))[0].data.authorizationId, view.id);

    // Without a session id nothing is invented.
    await setPolicy(db, agent.id, rules);
    assert.equal("by" in (await events(db, agent.id, "policy.updated")).at(-1)!.data, false);
  } finally {
    await db.close();
  }
});

// ---- the gateway's outcome event --------------------------------------------------------------------------------

async function gatewayCase() {
  const dir = mkdtempSync(path.join(tmpdir(), "tend-audit-"));
  writeFileSync(path.join(dir, "a.txt"), "FICTIONAL note\n");
  process.env.TEND_GATEWAY_NOTES_DIR = dir;
  const db = await memoryDb();
  const { agent } = await registerAgent(db, { name: "Reader", model: "m", provider: "Anthropic" });
  await setPolicy(db, agent.id, [{ tool: "list_notes", action: "list", effect: "approve" }], "enforce");
  const a = (await getAgent(db, agent.id))!;
  const { view } = await requestExecution(db, a, { tool: "list_notes", params: {} }, null);
  await decide(db, view.id, "approved");
  const { view: claimed } = await claimToken(db, a, view.id);
  if (!("token" in claimed)) throw new Error("expected an approved authorization to yield a token");
  const body = { authorizationId: view.id, token: claimed.token, tool: "list_notes", params: {} };
  /** Like the real db, except that transactions after the first (the consume) fail `failures` times. */
  const flaky = (failures: number): DB => {
    let calls = 0;
    return { ...db, tx: (fn) => (++calls > 1 && calls <= 1 + failures ? Promise.reject(new Error("connection lost")) : db.tx(fn)) } as DB;
  };
  return { db, a, body, flaky, done: async () => (delete process.env.TEND_GATEWAY_NOTES_DIR, rmSync(dir, { recursive: true, force: true }), db.close()) };
}

test("a failed outcome write is retried; the outcome is recorded once it succeeds", async () => {
  const s = await gatewayCase();
  try {
    const out = await executeTool(s.flaky(2), s.a, s.body);
    assert.equal(out.executed, true);
    const called = await events(s.db, s.a.id, "tool.called");
    assert.deepEqual(called.map((e) => [e.data.outcome, e.data.via]), [["success", "gateway"]]);
  } finally {
    await s.done();
  }
});

test("if the outcome can never be written the action is not hidden: the consume event remains and the gap is logged", async (t) => {
  const s = await gatewayCase();
  const logged: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => void logged.push(args));
  try {
    const out = await executeTool(s.flaky(3), s.a, s.body);
    assert.equal(out.executed, true, "the tool ran; its result is not withheld");
    assert.equal((await events(s.db, s.a.id, "tool.called")).length, 0);
    assert.equal((await events(s.db, s.a.id, "authorization.consumed")).length, 1, "authorized and spent, on record");
    assert.deepEqual(logged, [["[tend] gateway could not record an event"]], "logged without describing the action");
  } finally {
    await s.done();
  }
});

// ---- append-only history ----------------------------------------------------------------------------------------

test("ordinary statements cannot change or remove historical events", async () => {
  const db = await memoryDb();
  try {
    const { agent } = await registerAgent(db, { name: "Clerk", model: "m", provider: "Anthropic" });
    const before = await db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM events");
    assert.ok(before!.n > 0);
    assert.equal(await sqlState(() => db.run("UPDATE events SET data = '{}'")), "42501");
    assert.equal(await sqlState(() => db.run("UPDATE events SET at = 0 WHERE agent_id = ?", agent.id)), "42501");
    assert.equal(await sqlState(() => db.run("DELETE FROM events WHERE agent_id = ?", agent.id)), "42501");
    assert.equal(await sqlState(() => db.exec("TRUNCATE events")), "42501");
    assert.equal(await sqlState(() => db.run("DELETE FROM agents WHERE id = ?", agent.id)), "42501", "deleting an agent would cascade into its history");
    assert.equal(await sqlState(() => db.tx((q) => q.run("DELETE FROM events"))), "42501", "a transaction is no different");
    assert.equal((await db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM events"))!.n, before!.n);
    await db.tx((q) => insertEvent(q, { agentId: agent.id, type: "agent.idle", actor: "agent" }));
    assert.equal((await db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM events"))!.n, before!.n + 1, "appending still works");
  } finally {
    await db.close();
  }
});

test("only a transaction that raises the maintenance flag can remove events, and the flag does not outlive it", async () => {
  const db = await memoryDb();
  try {
    const { agent } = await registerAgent(db, { name: "Clerk", model: "m", provider: "Anthropic" });
    await db.tx(async (q) => {
      await allowEventRemoval(q);
      await q.run("DELETE FROM events WHERE agent_id = ?", agent.id);
    });
    assert.equal((await db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM events WHERE agent_id = ?", agent.id))!.n, 0);
    const again = await registerAgent(db, { name: "Second", model: "m", provider: "Anthropic" });
    assert.equal(await sqlState(() => db.run("DELETE FROM events WHERE agent_id = ?", again.agent.id)), "42501", "protection is back after the transaction");
  } finally {
    await db.close();
  }
});

test("the demo's retention and reset still work, and never touch a connected agent's history", async () => {
  const db = await memoryDb();
  try {
    const now = Date.now();
    await seedDemo(db, now);
    const { agent } = await registerAgent(db, { name: "Real", model: "m", provider: "Anthropic" });
    const demoAgent = (await db.get<{ id: string }>("SELECT id FROM agents WHERE origin = 'demo' LIMIT 1"))!.id;
    const old = await db.tx((q) => insertEvent(q, { agentId: demoAgent, type: "agent.idle", actor: "simulation", at: 1 }));
    await advanceDemo(db, now);
    assert.equal(await db.get("SELECT 1 FROM events WHERE id = ?", old.id), undefined, "old simulated events are pruned");
    await resetDemo(db, now);
    assert.equal((await events(db, agent.id, "agent.registered")).length, 1, "the connected agent's history survives a reset");
    assert.ok((await db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM agents WHERE origin = 'demo'"))!.n > 0, "the demo is seeded again");
  } finally {
    await db.close();
  }
});
