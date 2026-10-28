// Run with `npm test`. Exercises the server domain against an in-memory Postgres (PGlite).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { PROTOCOL } from "../lib/contract.ts";
import { isOnline } from "../lib/projection.ts";
import { checkAdminToken } from "./auth.ts";
import { isOperator, sessionCookieName, viewerOf } from "./session.ts";
import { signedIn } from "./test-support.ts";
import { memoryDb, migrate, MIGRATIONS, pglite } from "./db.ts";
import { advanceDemo, seedDemo } from "./demo.ts";
import { HttpError, limit } from "./http.ts";
import { agentByKey, control, decide, getAgent, inbox, ingestCheckIn, ingestEvents, registerAgent, requestCheckIn } from "./repo.ts";
import { since, snapshot } from "./sync.ts";

process.env.TEND_ADMIN_TOKEN = "test-admin-token-0123456789abcdef";
process.env.TEND_PUBLIC = "1";

const responses = {
  instructions: { answer: "yes", confidence: 90 }, context: { answer: "yes", confidence: 80 }, conflicts: { answer: "no", confidence: 85 },
  review: { answer: "no", confidence: 95 }, improvements: { answer: "yes", confidence: 70 },
};
const operator = { role: "operator", canAct: true, public: true, operatorAvailable: true, demo: true } as const;
const visitor = { ...operator, role: "visitor", canAct: false } as const;
const code = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (e) {
    return (e as HttpError).code;
  }
  return "ok";
};

test("agent keys are hashed, and only the exact key authenticates", async () => {
  const db = await memoryDb();
  const { agent, apiKey } = await registerAgent(db, { name: "Probe", model: "claude-sonnet", provider: "Anthropic" });
  assert.match(apiKey, /^tend_sk_/);
  assert.equal((await agentByKey(db, apiKey))?.id, agent.id);
  assert.equal(await agentByKey(db, apiKey.slice(0, -1) + "x"), undefined);
  const dump = JSON.stringify(await db.all("SELECT * FROM agents"));
  assert.equal(dump.includes(apiKey), false, "raw key must never be stored");
  assert.equal(await code(() => registerAgent(db, { name: "", provider: "Nope" })), "invalid_agent");
  await db.close();
});

test("ingestion validates types, strips unknown fields and enforces pause and disable", async () => {
  const db = await memoryDb();
  const { agent } = await registerAgent(db, { name: "Probe", model: "m", provider: "Custom" });
  const [r] = await ingestEvents(db, agent, [{ type: "task.started", data: { taskId: "t1", title: "Index docs", secret: "x" }, permissions: ["admin"] }]);
  assert.equal(r.status, "stored");
  const row = await db.get<{ data: string }>("SELECT data FROM events WHERE id = ?", r.id);
  assert.deepEqual(JSON.parse(row!.data), { taskId: "t1", title: "Index docs" });
  assert.equal(await code(() => ingestEvents(db, agent, [{ type: "agent.paused" }])), "invalid_event");
  assert.equal(await code(() => ingestEvents(db, agent, [{ type: "task.started", data: { taskId: "bad id!", title: "x" } }])), "invalid_event");
  // Idempotency: the same key stores once.
  await ingestEvents(db, agent, [{ type: "task.completed", data: { taskId: "t1" }, idempotencyKey: "done-1" }]);
  const [dup] = await ingestEvents(db, agent, [{ type: "task.completed", data: { taskId: "t1" }, idempotencyKey: "done-1" }]);
  assert.equal(dup.status, "duplicate");
  // Paused agents may finish work but not start it.
  await control(db, agent.id, "pause");
  const paused = (await getAgent(db, agent.id))!;
  assert.equal(await code(() => ingestEvents(db, paused, [{ type: "task.started", data: { taskId: "t2", title: "x" } }])), "agent_paused");
  assert.equal((await ingestEvents(db, paused, [{ type: "agent.idle" }]))[0].status, "stored");
  await control(db, agent.id, "disable");
  assert.equal(await code(async () => ingestEvents(db, (await getAgent(db, agent.id))!, [{ type: "agent.idle" }])), "integration_disabled");
  await db.close();
});

test("reviews: agents propose, only a decision grants a permission, and the agent must acknowledge", async () => {
  const db = await memoryDb();
  const { agent } = await registerAgent(db, { name: "Probe", model: "m", provider: "Custom" });
  const c = await ingestCheckIn(db, agent, { protocol: PROTOCOL, responses, proposedAdjustment: { kind: "permission", title: "Write", permission: "calendar.write" } }, "agent");
  assert.equal(c.requiresReview, true);
  assert.deepEqual((await getAgent(db, agent.id))!.permissions, []);
  assert.equal(await code(() => ingestCheckIn(db, agent, { protocol: PROTOCOL, agentId: "someone-else", responses }, "agent")), "agent_mismatch");
  const events = await decide(db, c.id, "approved", "Limited to holds");
  assert.deepEqual(events.map((e) => e.type), ["review.decided", "permission.granted"]);
  const after = (await getAgent(db, agent.id))!;
  assert.deepEqual(after.permissions, ["calendar.write"]);
  assert.equal(after.configVersion, 2);
  assert.equal(after.ackedVersion, 0);
  assert.equal(await code(() => decide(db, c.id, "rejected")), "already_decided");
  assert.equal(await code(() => ingestEvents(db, after, [{ type: "config.acknowledged", data: { version: 9 } }])), "invalid_event");
  await ingestEvents(db, after, [{ type: "config.acknowledged", data: { version: 2 } }]);
  assert.equal((await getAgent(db, agent.id))!.ackedVersion, 2);
  await db.close();
});

test("check-in requests are delivered through the inbox and answered by the next check-in", async () => {
  const db = await memoryDb();
  const { agent } = await registerAgent(db, { name: "Probe", model: "m", provider: "Custom" });
  await requestCheckIn(db, agent.id);
  assert.equal(await code(() => requestCheckIn(db, agent.id)), "already_requested");
  const box = await inbox(db, agent);
  assert.equal(box.requests.length, 1);
  assert.equal(box.config.version, 1);
  const types = (await db.all<{ type: string }>("SELECT type FROM events ORDER BY seq")).map((r) => r.type);
  assert.ok(types.includes("checkin.request.delivered"));
  await ingestCheckIn(db, agent, { protocol: PROTOCOL, responses }, "agent");
  assert.equal((await inbox(db, agent)).requests.length, 0);
  await db.close();
});

test("snapshot and incremental sync agree, and visitors never see private agents", async () => {
  const db = await memoryDb();
  const now = Date.now();
  await seedDemo(db, now);
  await advanceDemo(db, now);
  const { agent, apiKey } = await registerAgent(db, { name: "Probe", model: "m", provider: "Custom" });
  const before = await snapshot(db, operator, now);
  assert.equal(before.projection.checkIns.filter((c) => c.review?.status === "pending").length >= 3, true);
  assert.ok(before.projection.taskEvents.length > 0, "demo simulation produced task events");
  await ingestEvents(db, (await agentByKey(db, apiKey))!, [{ type: "task.started", data: { taskId: "t9", title: "Summarize logs" } }]);
  const inc = await since(db, operator, before.seq, now);
  assert.equal(inc.events.some((e) => e.type === "task.started" && e.agentId === agent.id), true);
  const after = await snapshot(db, operator, now);
  assert.equal(after.projection.tasks[agent.id]?.title, "Summarize logs");
  assert.equal(isOnline(after.projection.agents.find((a) => a.id === agent.id)!, Date.now()), true);
  // Simulated agents are labelled as such; connected ones as connected.
  assert.ok(after.projection.agents.filter((a) => a.id !== agent.id).every((a) => a.origin === "demo"));
  assert.equal(after.projection.agents.find((a) => a.id === agent.id)!.origin, "connected");
  // A private connected agent is invisible to visitors.
  const pub = await snapshot(db, visitor, now);
  assert.equal(pub.projection.agents.some((a) => a.id === agent.id), false);
  assert.equal((await since(db, visitor, before.seq, now)).events.some((e) => e.agentId === agent.id), false);
  assert.equal("keys" in pub, false);
  await db.close();
});

test("two instances advancing the demo at once don't duplicate simulated events", async () => {
  const db = await memoryDb();
  const now = Date.now();
  await seedDemo(db, now);
  await Promise.all([advanceDemo(db, now), advanceDemo(db, now), seedDemo(db, now)]);
  const rows = await db.all<{ n: number }>("SELECT COUNT(*) AS n FROM events WHERE type LIKE 'task.%' GROUP BY agent_id, data HAVING COUNT(*) > 1");
  assert.equal(rows.length, 0);
  assert.equal((await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM agents WHERE origin = 'demo'"))!.n, 6);
  await db.close();
});

test("data persists across restarts of an on-disk database", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "tend-"));
  // A data directory that doesn't exist yet, as with a fresh TEND_DATA_DIR.
  const dir = path.join(root, "fresh", "pglite");
  try {
    let db = await pglite(dir);
    await migrate(db);
    const { apiKey } = await registerAgent(db, { name: "Keeper", model: "m", provider: "Custom" });
    await db.close();
    db = await pglite(dir);
    await migrate(db);
    assert.equal((await agentByKey(db, apiKey))?.name, "Keeper");
    await db.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the admin token is compared exactly; a session is a server-side record that must be the one issued", async () => {
  assert.equal(checkAdminToken("test-admin-token-0123456789abcdef"), true);
  assert.equal(checkAdminToken("wrong"), false);
  const db = await memoryDb();
  try {
    const me = await signedIn(db);
    assert.equal(await isOperator(db, me.request()), true);
    assert.equal((await viewerOf(db, me.request())).canAct, true);
    assert.equal((await viewerOf(db, new Request("http://x/"))).canAct, false);
    const flipped = me.value.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    assert.equal(await isOperator(db, new Request("http://x/", { headers: { cookie: `${sessionCookieName()}=${flipped}` } })), false);
  } finally {
    await db.close();
  }
});

test("the shared rate limiter allows the limit, then refuses", async () => {
  const db = await memoryDb();
  // Windows are calendar minutes; don't let the calls straddle two of them.
  if (Date.now() % 60_000 > 58_000) await new Promise((r) => setTimeout(r, 60_000 - (Date.now() % 60_000) + 50));
  for (let i = 0; i < 5; i++) await limit(db, "test-key", 5);
  await assert.rejects(limit(db, "test-key", 5), (e: HttpError) => e.status === 429);
  await limit(db, "other-key", 5);
  await db.close();
});

test("tool calls: Tend flags policy violations, repeated failures and executions without approval", async () => {
  const db = await memoryDb();
  const { agent } = await registerAgent(db, { name: "Probe", model: "m", provider: "Anthropic" });
  const tool = (data: object) => ingestEvents(db, agent, [{ type: "tool.called", data }]);
  const alerts = async () => (await db.all<{ data: string }>("SELECT data FROM events WHERE type = 'alert.raised' ORDER BY seq")).map((r) => JSON.parse(r.data));

  // Only identifiers are stored; unknown fields such as document contents are dropped.
  const [ok] = await tool({ tool: "read_document", action: "read", outcome: "success", resource: "DOC-1", content: "secret text" });
  assert.deepEqual(ok.alerts, undefined);
  assert.equal(JSON.stringify(await db.all("SELECT data FROM events")).includes("secret text"), false);
  assert.equal(await code(() => tool({ tool: "read_document", action: "read", outcome: "maybe" })), "invalid_event");

  // A refused attempt on a permission the agent wasn't granted is a blocked violation.
  const [denied] = await tool({ tool: "read_document", action: "read", outcome: "denied", resource: "DOC-R-1", permission: "docs.restricted.read", policy: "restricted_document" });
  assert.deepEqual(denied.alerts, ["policy_violation"]);
  // A runtime that executes it anyway is caught too, independently of what the runtime claims.
  const [leak] = await tool({ tool: "read_document", action: "read", outcome: "success", resource: "DOC-R-1", permission: "docs.restricted.read" });
  assert.deepEqual(leak.alerts, ["policy_violation"]);
  assert.deepEqual((await alerts()).map((a) => [a.kind, a.blocked]), [["policy_violation", true], ["policy_violation", false]]);

  // Failures alert once at the threshold, per tool, within the window.
  for (let i = 0; i < 2; i++) await tool({ tool: "create_task", action: "create", outcome: "failure" });
  await tool({ tool: "read_document", action: "read", outcome: "failure" });
  const [third] = await tool({ tool: "create_task", action: "create", outcome: "failure" });
  assert.deepEqual(third.alerts, ["repeated_failures"]);
  const [fourth] = await tool({ tool: "create_task", action: "create", outcome: "failure" });
  assert.equal(fourth.alerts, undefined);

  // An action held for approval opens a review; the decision reaches the agent through its inbox.
  const [held] = await tool({ tool: "send_payment", action: "create", outcome: "pending_approval", approval: "required", detail: "EUR 480.00 to Test GmbH" });
  assert.deepEqual((await inbox(db, agent)).approvals, [{ id: held.id, status: "pending" }]);
  const exec = { tool: "send_payment", action: "execute", outcome: "success", approval: "required", detail: "EUR 480.00 to Test GmbH" };
  const [early] = await tool({ ...exec, approvalId: held.id });
  assert.deepEqual(early.alerts, ["unapproved_execution"]);
  await decide(db, held.id!, "approved");
  assert.deepEqual((await inbox(db, agent)).approvals, [{ id: held.id, status: "approved" }]);
  const [paid] = await tool({ ...exec, approvalId: held.id });
  assert.equal(paid.alerts, undefined);
  const [twice] = await tool({ ...exec, approvalId: held.id });
  assert.deepEqual(twice.alerts, ["unapproved_execution"]);
  assert.deepEqual((await alerts()).slice(-1)[0].reason, "approval_reused");

  // The projection shows all of it: tool events, the review request and the alerts in the log.
  const snap = await snapshot(db, operator);
  const p = snap.projection;
  assert.equal(p.taskEvents.filter((t) => t.type === "tool.called").length, 12);
  assert.deepEqual(p.requests.map((r) => [r.id, r.review.status]), [[held.id, "approved"]]);
  assert.deepEqual(p.log.filter((l) => l.actor === "system").map((l) => l.type).reverse(), ["policy_violation", "policy_violation", "repeated_failures", "unapproved_execution", "unapproved_execution"]);
  // A paused agent can't use tools.
  await control(db, agent.id, "pause");
  assert.equal(await code(async () => ingestEvents(db, (await getAgent(db, agent.id))!, [{ type: "tool.called", data: { tool: "x", action: "y", outcome: "success" } }])), "agent_paused");
  await db.close();
});

test("an approval covers only the tool, resource and detail that were approved", async () => {
  const db = await memoryDb();
  const { agent } = await registerAgent(db, { name: "Probe", model: "m", provider: "Anthropic" });
  const tool = (data: object) => ingestEvents(db, agent, [{ type: "tool.called", data }]);
  const reasons = async () => (await db.all<{ data: string }>("SELECT data FROM events WHERE type = 'alert.raised' ORDER BY seq")).map((r) => JSON.parse(r.data).reason);
  const ask = { tool: "send_payment", action: "create", outcome: "pending_approval", approval: "required", resource: "INV-1", detail: "EUR 480.00 to Test GmbH" };
  const run = { tool: "send_payment", action: "execute", outcome: "success", approval: "required", resource: "INV-1", detail: "EUR 480.00 to Test GmbH" };
  const approved = async () => {
    const [held] = await tool(ask);
    await decide(db, held.id!, "approved");
    return held.id!;
  };

  // The same tool, resource and detail as approved: no alert.
  const ok = await approved();
  assert.equal((await tool({ ...run, approvalId: ok }))[0].alerts, undefined);

  // Anything else is flagged, whichever field differs (a missing detail counts as different).
  for (const other of [{ detail: "EUR 9000.00 to Someone Else" }, { detail: undefined }, { resource: "INV-2" }, { resource: undefined }, { tool: "send_refund" }]) {
    const id = await approved();
    assert.deepEqual((await tool({ ...run, ...other, approvalId: id }))[0].alerts, ["unapproved_execution"]);
    assert.equal((await reasons()).slice(-1)[0], "approval_mismatch");
  }

  // An approved review of another kind (a permission request) is not an approval for an action.
  const [req] = await ingestEvents(db, agent, [{ type: "review.requested", data: { reason: "need access" } }]);
  await decide(db, req.id!, "approved");
  assert.deepEqual((await tool({ ...run, approvalId: req.id }))[0].alerts, ["unapproved_execution"]);
  assert.equal((await reasons()).slice(-1)[0], "not_approved");
  await db.close();
});

test("migration 2 upgrades a database created with migration 1 and keeps its reviews", async () => {
  const db = await pglite();
  await db.exec(MIGRATIONS[0]);
  await db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at BIGINT NOT NULL)");
  await db.run("INSERT INTO schema_migrations VALUES (1, 0)");
  await db.run("INSERT INTO agents (id, profile, origin, created_at) VALUES ('a', '{}', 'connected', 0)");
  await db.run("INSERT INTO reviews (id, agent_id, status) VALUES ('r', 'a', 'pending')");
  assert.equal(await code(() => db.run("UPDATE reviews SET status = 'withdrawn'")), "23514", "v1 rejects withdrawn (check_violation)");
  await migrate(db);
  assert.equal(await db.run("UPDATE reviews SET status = 'withdrawn' WHERE id = 'r'"), 1);
  assert.equal(await code(() => db.run("UPDATE reviews SET status = 'bogus'")), "23514", "still constrained");
  await db.close();
});
