// The same guarantees as the in-memory tests, proven on real PostgreSQL with a real connection pool. PGlite runs one
// connection, so it can't show that the advisory lock, the row locks and the conditional UPDATEs hold when requests
// truly overlap. This file does.
//
// It is skipped unless TEND_TEST_DATABASE_URL points at a PostgreSQL server on this machine. Each test creates its own
// database with a random name and drops it afterwards; nothing else on the server is read or changed.
//
//   npm run test:postgres        starts a temporary local cluster (initdb), runs this file, throws the cluster away
//   TEND_TEST_DATABASE_URL=postgres://user@127.0.0.1:5432/postgres node --no-warnings --test src/server/postgres.test.ts
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import pg from "pg";
import { claimToken, consumeAuthorization, requestAuthorization } from "./authz.ts";
import { allowEventRemoval, migrate, MIGRATIONS, postgres, type DB } from "./db.ts";
import { resetDemo, seedDemo } from "./demo.ts";
import { executeTool, requestExecution } from "./gateway.ts";
import { integrationStatus } from "./integrations.ts";
import { policyView } from "./permissions.ts";
import { assignCentralPolicy, createCentralPolicy, decide, getAgent, ingestEvents, QUOTA, registerAgent, revokeKey, setPolicy, updateCentralPolicy } from "./repo.ts";
import { latestVerification, runVerification } from "./verification.ts";
import { isOperator, revokeAll, sessionCookieName, signOut } from "./session.ts";
import { awayFromMinuteBoundary } from "./test-support.ts";
import { FAILURES_PER_MINUTE, signIn } from "./signin.ts";

const URL_ = process.env.TEND_TEST_DATABASE_URL ?? "";
const skip = URL_ ? false : "set TEND_TEST_DATABASE_URL (or run `npm run test:postgres`) to test against real PostgreSQL";

/** Never touch a server that isn't on this machine: the tests create and drop databases. */
function assertLocal(url: string) {
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost", "[::1]", "::1", ""].includes(host)) throw new Error(`TEND_TEST_DATABASE_URL must point at this machine, not ${host}`);
}

async function tempDb() {
  assertLocal(URL_);
  const admin = new pg.Client({ connectionString: URL_ });
  await admin.connect();
  const name = `tend_test_${randomBytes(6).toString("hex")}`;
  await admin.query(`CREATE DATABASE ${name}`);
  const u = new URL(URL_);
  u.pathname = `/${name}`;
  const db = await postgres(u.toString());
  await migrate(db);
  return {
    db,
    close: async () => {
      await db.close();
      await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.end();
    },
  };
}

const sqlState = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return "ok";
};
const count = async (db: DB, sql: string, ...p: unknown[]) => (await db.get<{ n: number }>(sql, ...p))!.n;
const settled = (xs: PromiseSettledResult<unknown>[]) => ({ ok: xs.filter((x) => x.status === "fulfilled").length, failed: xs.filter((x) => x.status === "rejected") as PromiseRejectedResult[] });

/** Opens every pool connection first. A cold pool connects lazily, which quietly serialises "parallel" work on the one warm connection. */
const warm = (db: DB) => Promise.all(Array.from({ length: 4 }, () => db.get("SELECT pg_sleep(0.15)")));

/** A connected agent whose policy asks a person for tool "t", action "a". */
async function agentWithPolicy(db: DB) {
  const { agent } = await registerAgent(db, { name: "Clerk", model: "m", provider: "Anthropic" });
  await setPolicy(db, agent.id, [{ tool: "t", action: "a", effect: "approve" }], "enforce");
  return (await getAgent(db, agent.id))!;
}

test("the database is PostgreSQL, every migration is applied, and the pool really has several connections", { skip }, async () => {
  const t = await tempDb();
  try {
    assert.equal(t.db.kind, "postgres");
    assert.equal(await count(t.db, "SELECT COUNT(*)::int AS n FROM schema_migrations"), MIGRATIONS.length);
    const pids = new Set((await Promise.all(Array.from({ length: 8 }, () => t.db.get<{ p: number }>("SELECT pg_backend_pid() AS p, pg_sleep(0.1)")))).map((r) => r!.p));
    assert.ok(pids.size > 1, "overlapping queries use more than one backend, so the concurrency tests below are meaningful");
  } finally {
    await t.close();
  }
});

test("append-only events: UPDATE, DELETE and TRUNCATE are refused; only a transaction with the flag may delete, and the flag never leaks", { skip }, async () => {
  const t = await tempDb();
  try {
    const { agent } = await registerAgent(t.db, { name: "Clerk", model: "m", provider: "Anthropic" });
    const n = await count(t.db, "SELECT COUNT(*)::int AS n FROM events");
    assert.ok(n > 0);
    assert.equal(await sqlState(() => t.db.run("UPDATE events SET data = '{}'")), "42501");
    assert.equal(await sqlState(() => t.db.run("DELETE FROM events")), "42501");
    assert.equal(await sqlState(() => t.db.exec("TRUNCATE events")), "42501");
    assert.equal(await sqlState(() => t.db.run("DELETE FROM agents WHERE id = ?", agent.id)), "42501", "the cascade is refused too");
    assert.equal(await count(t.db, "SELECT COUNT(*)::int AS n FROM events"), n);

    // The flag lives and dies with one transaction, also when it rolls back, and never reaches other pooled connections.
    await t.db.tx(async (q) => allowEventRemoval(q)).then(() => undefined);
    await assert.rejects(t.db.tx(async (q) => (await allowEventRemoval(q), Promise.reject(new Error("abort")))), /abort/);
    for (let i = 0; i < 8; i++) assert.equal(await sqlState(() => t.db.run("DELETE FROM events")), "42501", `attempt ${i + 1}`);
    await t.db.tx(async (q) => {
      await allowEventRemoval(q);
      await q.run("DELETE FROM events WHERE agent_id = ?", agent.id);
    });
    assert.equal(await count(t.db, "SELECT COUNT(*)::int AS n FROM events WHERE agent_id = ?", agent.id), 0);
  } finally {
    await t.close();
  }
});

test("replay: of ten overlapping consume attempts exactly one wins", { skip }, async () => {
  const t = await tempDb();
  try {
    const agent = await agentWithPolicy(t.db);
    const { view } = await requestAuthorization(t.db, agent, { tool: "t", action: "a" }, null);
    await decide(t.db, view.id, "approved");
    const { view: claimed } = await claimToken(t.db, agent, view.id);
    if (!("token" in claimed)) throw new Error("expected a token");
    const body = { token: claimed.token, tool: "t", action: "a" };
    await warm(t.db);
    const r = settled(await Promise.allSettled(Array.from({ length: 10 }, () => consumeAuthorization(t.db, agent, view.id, body))));
    assert.equal(r.ok, 1);
    assert.ok(r.failed.every((f) => (f.reason as { code?: string }).code === "already_consumed"));
    assert.equal(await count(t.db, "SELECT COUNT(*)::int AS n FROM events WHERE type = 'authorization.consumed'"), 1);
  } finally {
    await t.close();
  }
});

test("two people deciding at once: one decision wins and the authorization follows it", { skip }, async () => {
  const t = await tempDb();
  try {
    const agent = await agentWithPolicy(t.db);
    for (let round = 0; round < 5; round++) {
      const { view } = await requestAuthorization(t.db, agent, { tool: "t", action: "a" }, null);
      await warm(t.db);
      const r = settled(await Promise.allSettled([decide(t.db, view.id, "approved", undefined, "aaaaaaaaaaaaaaaa"), decide(t.db, view.id, "rejected", undefined, "bbbbbbbbbbbbbbbb")]));
      assert.equal(r.ok, 1);
      const az = await t.db.get<{ status: string }>("SELECT status FROM authorizations WHERE id = ?", view.id);
      const rv = await t.db.get<{ status: string }>("SELECT status FROM reviews WHERE id = ?", view.id);
      assert.equal(az!.status, rv!.status);
      assert.equal(await count(t.db, "SELECT COUNT(*)::int AS n FROM events WHERE type = 'review.decided' AND (data::jsonb)->>'reviewId' = ?", view.id), 1);
    }
  } finally {
    await t.close();
  }
});

test("two people deciding on an ordinary review at once: only one decision is recorded", { skip }, async () => {
  const t = await tempDb();
  try {
    const { agent } = await registerAgent(t.db, { name: "Clerk", model: "m", provider: "Anthropic" });
    const a = (await getAgent(t.db, agent.id))!;
    for (let round = 0; round < 5; round++) {
      const [stored] = await ingestEvents(t.db, a, [{ type: "review.requested", data: { reason: `please review ${round}` } }]);
      await warm(t.db);
      const r = settled(await Promise.allSettled([decide(t.db, stored.id!, "approved"), decide(t.db, stored.id!, "rejected")]));
      assert.equal(r.ok, 1);
      assert.equal(await count(t.db, "SELECT COUNT(*)::int AS n FROM events WHERE type = 'review.decided' AND (data::jsonb)->>'reviewId' = ?", stored.id!), 1);
    }
  } finally {
    await t.close();
  }
});

test("a decision records which session made it", { skip }, async () => {
  const t = await tempDb();
  try {
    const agent = await agentWithPolicy(t.db);
    const { view } = await requestAuthorization(t.db, agent, { tool: "t", action: "a" }, null);
    await decide(t.db, view.id, "approved", undefined, "0123456789abcdef");
    const e = await t.db.get<{ by: string }>("SELECT (data::jsonb)->>'by' AS by FROM events WHERE type = 'review.decided'");
    assert.equal(e!.by, "0123456789abcdef");
  } finally {
    await t.close();
  }
});

test("saving rules from the same version twice at once: one wins, the others are told the rules changed", { skip }, async () => {
  const t = await tempDb();
  try {
    const { agent } = await registerAgent(t.db, { name: "Clerk", model: "m", provider: "Anthropic" });
    const v = (await policyView(t.db, agent.id)).version;
    await warm(t.db);
    const rules = (effect: string) => [{ tool: "list_notes", action: "list", effect }];
    const r = settled(await Promise.allSettled(["allow", "approve", "deny", "approve"].map((e) => setPolicy(t.db, agent.id, rules(e), "enforce", undefined, v))));
    assert.equal(r.ok, 1);
    assert.ok(r.failed.every((f) => (f.reason as { code?: string }).code === "policy_changed"));
    assert.equal((await policyView(t.db, agent.id)).version, v + 1, "the version moved exactly once");
    assert.equal(await count(t.db, "SELECT COUNT(*)::int AS n FROM events WHERE type = 'policy.updated'"), 1);
  } finally {
    await t.close();
  }
});

test("spending can't be allowed: refused on save, and a policy stored the old way still asks a person", { skip }, async () => {
  const t = await tempDb();
  try {
    const { agent } = await registerAgent(t.db, { name: "Payer", model: "m", provider: "Anthropic" });
    assert.equal(await sqlState(() => setPolicy(t.db, agent.id, [{ tool: "pay_invoice", action: "execute", effect: "allow" }], "enforce")), "spend_requires_approval");
    await t.db.run("UPDATE agents SET policy = ? WHERE id = ?", JSON.stringify([{ tool: "pay_invoice", action: "execute", effect: "allow" }]), agent.id);
    const { view } = await requestExecution(t.db, (await getAgent(t.db, agent.id))!, { tool: "pay_invoice", params: { invoice: "INV-1", amountCents: 500, currency: "EUR", payee: "PAYEE-1" } }, null);
    assert.equal(view.status, "pending");
  } finally {
    await t.close();
  }
});

test("the gateway runs a tool once when five identical executions overlap, and records it once", { skip }, async () => {
  const t = await tempDb();
  const dir = mkdtempSync(path.join(tmpdir(), "tend-pg-notes-"));
  writeFileSync(path.join(dir, "a.txt"), "FICTIONAL note\n");
  process.env.TEND_GATEWAY_NOTES_DIR = dir;
  try {
    const { agent } = await registerAgent(t.db, { name: "Reader", model: "m", provider: "Anthropic" });
    await setPolicy(t.db, agent.id, [{ tool: "list_notes", action: "list", effect: "approve" }], "enforce");
    const a = (await getAgent(t.db, agent.id))!;
    const { view } = await requestExecution(t.db, a, { tool: "list_notes", params: {} }, null);
    await decide(t.db, view.id, "approved");
    const { view: claimed } = await claimToken(t.db, a, view.id);
    if (!("token" in claimed)) throw new Error("expected a token");
    const body = { authorizationId: view.id, token: claimed.token, tool: "list_notes", params: {} };
    await warm(t.db);
    const r = settled(await Promise.allSettled(Array.from({ length: 5 }, () => executeTool(t.db, a, body))));
    assert.equal(r.ok, 1);
    assert.equal(await count(t.db, "SELECT COUNT(*)::int AS n FROM events WHERE type = 'authorization.consumed'"), 1);
    assert.equal(await count(t.db, "SELECT COUNT(*)::int AS n FROM events WHERE type = 'tool.called' AND (data::jsonb)->>'outcome' = 'success'"), 1);
  } finally {
    delete process.env.TEND_GATEWAY_NOTES_DIR;
    rmSync(dir, { recursive: true, force: true });
    await t.close();
  }
});

test("sandbox tools on a real pool: eight overlapping executions write once, a denied delete never deletes, and the integration status reads the log", { skip }, async () => {
  const t = await tempDb();
  const dir = mkdtempSync(path.join(tmpdir(), "tend-pg-sandbox-"));
  writeFileSync(path.join(dir, "hello.txt"), "FICTIONAL hello\n");
  process.env.TEND_GATEWAY_SANDBOX_DIR = dir;
  try {
    const { agent } = await registerAgent(t.db, { name: "OpenAI sandbox agent", model: "m", provider: "OpenAI" });
    await setPolicy(t.db, agent.id, [
      { tool: "read_test_file", action: "read", effect: "allow" },
      { tool: "write_test_file", action: "create", effect: "approve" },
      { tool: "delete_test_file", action: "delete", effect: "deny" },
    ], "enforce");
    const a = (await getAgent(t.db, agent.id))!;
    const params = { path: "note.txt", text: "approved once" };
    const { view } = await requestExecution(t.db, a, { tool: "write_test_file", params }, null);
    await decide(t.db, view.id, "approved");
    const { view: claimed } = await claimToken(t.db, a, view.id);
    if (!("token" in claimed)) throw new Error("expected a token");
    const body = { authorizationId: view.id, token: claimed.token, tool: "write_test_file", params };
    await warm(t.db);
    const r = settled(await Promise.allSettled(Array.from({ length: 8 }, () => executeTool(t.db, a, body))));
    assert.equal(r.ok, 1);
    assert.equal(readFileSync(path.join(dir, "note.txt"), "utf8"), "approved once\n");
    assert.equal(await count(t.db, "SELECT COUNT(*)::int AS n FROM events WHERE type = 'tool.called' AND (data::jsonb)->>'outcome' = 'success'"), 1);

    const denied = (await requestExecution(t.db, a, { tool: "delete_test_file", params: { path: "hello.txt" } }, null)).view;
    assert.equal(denied.status, "denied");
    assert.deepEqual(readdirSync(dir).sort(), ["hello.txt", "note.txt"]);

    const status = await integrationStatus(t.db);
    assert.deepEqual(status.sandbox, { configured: true, usable: true });
    assert.equal(status.providers.OpenAI[0].gateway.successes, 1);
    assert.equal(status.providers.OpenAI[0].policyAsRecommended, true);
  } finally {
    delete process.env.TEND_GATEWAY_SANDBOX_DIR;
    rmSync(dir, { recursive: true, force: true });
    await t.close();
  }
});

test("revoking a key while the agent is executing: the tool runs before the revocation or not at all, and two revocations record one", { skip }, async () => {
  const t = await tempDb();
  const dir = mkdtempSync(path.join(tmpdir(), "tend-pg-notes-"));
  process.env.TEND_GATEWAY_NOTES_DIR = dir;
  chmodSync(dir, 0o700);
  try {
    const { agent } = await registerAgent(t.db, { name: "Writer", model: "m", provider: "Anthropic" });
    await setPolicy(t.db, agent.id, [{ tool: "write_note", action: "create", effect: "approve" }], "enforce");
    const a = (await getAgent(t.db, agent.id))!;
    const params = { name: "race", text: "x" };
    const { view } = await requestExecution(t.db, a, { tool: "write_note", params }, null);
    await decide(t.db, view.id, "approved");
    const { view: claimed } = await claimToken(t.db, a, view.id);
    if (!("token" in claimed)) throw new Error("expected a token");
    await warm(t.db);
    const [run, r1, r2] = await Promise.allSettled([
      executeTool(t.db, a, { authorizationId: view.id, token: claimed.token, tool: "write_note", params }),
      revokeKey(t.db, agent.id),
      revokeKey(t.db, agent.id),
    ]);
    assert.equal(await count(t.db, "SELECT COUNT(*)::int AS n FROM events WHERE type = 'key.revoked'"), 1, "one revocation recorded, however many overlapped");
    assert.deepEqual([r1.status, r2.status], ["fulfilled", "fulfilled"]);
    const status = (await t.db.get<{ status: string }>("SELECT status FROM authorizations WHERE id = ?", view.id))!.status;
    // Serialised by the event lock: either the execution won (consumed, one file) or the revocation did (cancelled, no file). Never both, never neither.
    const wrote = readdirSync(dir).includes("race.txt");
    assert.deepEqual([status, wrote], run.status === "fulfilled" ? ["consumed", true] : ["cancelled", false]);
    assert.equal((await t.db.get<{ key_hash: string | null }>("SELECT key_hash FROM agents WHERE id = ?", agent.id))!.key_hash, null);
  } finally {
    delete process.env.TEND_GATEWAY_NOTES_DIR;
    rmSync(dir, { recursive: true, force: true });
    await t.close();
  }
});

test("one agent's flood on a real pool: overlapping batches admit exactly the allowance, overlapping review requests exactly the cap, overlapping authorization requests exactly the daily limit", { skip }, async () => {
  await awayFromMinuteBoundary();
  const t = await tempDb();
  const saved = { ...QUOTA };
  try {
    const { agent } = await registerAgent(t.db, { name: "Flooder", model: "m", provider: "Anthropic" });
    await setPolicy(t.db, agent.id, [{ tool: "t", action: "a", effect: "approve" }], "enforce");
    const a = (await getAgent(t.db, agent.id))!;
    const tasks = (n: number, tag: string) => Array.from({ length: n }, (_, i) => ({ type: "task.started", data: { taskId: `${tag}${i}`, title: "w" } }));
    await warm(t.db);

    const batches = settled(await Promise.allSettled(Array.from({ length: 40 }, (_, i) => ingestEvents(t.db, a, tasks(50, `b${i}-`)))));
    assert.equal(batches.ok, QUOTA.eventsPerMinute / 50, "never more than the allowance, however the requests interleave");
    assert.equal(await count(t.db, "SELECT COUNT(*)::int AS n FROM events WHERE type = 'task.started'"), QUOTA.eventsPerMinute);

    const asks = settled(await Promise.allSettled(Array.from({ length: 40 }, (_, i) => ingestEvents(t.db, a, [{ type: "review.requested", data: { reason: `r${i}` } }]))));
    // the minute's event allowance was already spent above, so use the review cap on a fresh agent instead
    assert.equal(asks.ok, 0);
    const { agent: other } = await registerAgent(t.db, { name: "Asker", model: "m", provider: "Anthropic" });
    const o = (await getAgent(t.db, other.id))!;
    const reviews = settled(await Promise.allSettled(Array.from({ length: 40 }, (_, i) => ingestEvents(t.db, o, [{ type: "review.requested", data: { reason: `r${i}` } }]))));
    assert.equal(reviews.ok, QUOTA.pendingReviews);
    assert.equal(await count(t.db, "SELECT COUNT(*)::int AS n FROM reviews WHERE agent_id = ? AND status = 'pending'", other.id), QUOTA.pendingReviews);

    QUOTA.authorizationsPerDay = 10;
    QUOTA.pendingReviews = 1_000;
    const { agent: third } = await registerAgent(t.db, { name: "Asker three", model: "m", provider: "Anthropic" });
    await setPolicy(t.db, third.id, [{ tool: "t", action: "a", effect: "deny" }], "enforce");
    const c = (await getAgent(t.db, third.id))!;
    const azs = settled(await Promise.allSettled(Array.from({ length: 30 }, (_, i) => requestAuthorization(t.db, c, { tool: "t", action: "a", resource: `r${i}` }, null))));
    assert.equal(azs.ok, 10);
    assert.equal(await count(t.db, "SELECT COUNT(*)::int AS n FROM authorizations WHERE agent_id = ?", third.id), 10);
  } finally {
    Object.assign(QUOTA, saved);
    await t.close();
  }
});

test("operator sessions on a real pool: parallel wrong tokens are admitted exactly ten at a time, parallel sign-outs end a session once, and nothing checked after a revocation gets in", { skip }, async () => {
  const t = await tempDb();
  const before = { token: process.env.TEND_ADMIN_TOKEN, proxy: process.env.TEND_TRUSTED_PROXY };
  process.env.TEND_ADMIN_TOKEN = "test-admin-token-0123456789abcdef";
  process.env.TEND_TRUSTED_PROXY = "1";
  try {
    const from = (ip: string, cookie?: string) => new Request("http://tend.test/api/operator/session", { method: "POST", headers: { "x-forwarded-for": ip, ...(cookie && { cookie }) } });
    await warm(t.db);
    const now = Date.UTC(2030, 0, 1, 10, 0, 30);
    const wrong = await Promise.allSettled(Array.from({ length: 40 }, () => signIn(t.db, from("203.0.113.66"), { token: "wrong-wrong-wrong-wrong-wrong-1" }, now, async () => {})));
    const status = wrong.map((r) => (r.status === "rejected" ? (r.reason as { status: number }).status : 200));
    assert.deepEqual([status.filter((s) => s === 401).length, status.filter((s) => s === 429).length], [FAILURES_PER_MINUTE, 30], "never more than ten evaluated, however the requests interleave");

    const sessions = await Promise.all(Array.from({ length: 8 }, () => signIn(t.db, from("203.0.113.5"), { token: process.env.TEND_ADMIN_TOKEN }, now)));
    assert.equal(new Set(sessions.map((s) => s.id)).size, 8);
    assert.equal(await count(t.db, "SELECT COUNT(*)::int AS n FROM auth_events WHERE type = 'signin.succeeded'"), 8, "each success has exactly one log line");

    const req = (s: { value: string }) => new Request("http://tend.test/", { headers: { cookie: `${sessionCookieName()}=${s.value}` } });
    const outs = await Promise.all(Array.from({ length: 12 }, () => signOut(t.db, req(sessions[0]))));
    assert.equal(outs.filter(Boolean).length, 1);
    assert.equal(await count(t.db, "SELECT COUNT(*)::int AS n FROM auth_events WHERE type = 'session.signed_out'"), 1);

    const racing = Promise.all(Array.from({ length: 30 }, () => isOperator(t.db, req(sessions[1]))));
    const done = await revokeAll(t.db, sessions[2].id);
    await racing;
    assert.equal(done, 7, "the seven that were still alive");
    const after = await Promise.all(sessions.map((s) => isOperator(t.db, req(s))));
    assert.equal(after.some(Boolean), false, "every one of them is refused once the revocation has returned");
  } finally {
    for (const [k, v] of [["TEND_ADMIN_TOKEN", before.token], ["TEND_TRUSTED_PROXY", before.proxy]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await t.close();
  }
});

test("the demo can still be reset on PostgreSQL, and a connected agent's history survives", { skip }, async () => {
  process.env.TEND_DEMO = "1";
  const t = await tempDb();
  try {
    await seedDemo(t.db, Date.now());
    const { agent } = await registerAgent(t.db, { name: "Real", model: "m", provider: "Anthropic" });
    await resetDemo(t.db, Date.now());
    assert.equal(await count(t.db, "SELECT COUNT(*)::int AS n FROM events WHERE agent_id = ? AND type = 'agent.registered'", agent.id), 1);
    assert.ok((await count(t.db, "SELECT COUNT(*)::int AS n FROM agents WHERE origin = 'demo'")) > 0);
  } finally {
    await t.close();
  }
});

test("protection checks on PostgreSQL: the records are read in a read-only transaction, only the run's own two records are written, and results are append-only", { skip }, async () => {
  const t = await tempDb();
  const dir = mkdtempSync(path.join(tmpdir(), "tend-pg-verify-"));
  chmodSync(dir, 0o700);
  try {
    const { agent } = await registerAgent(t.db, { name: "Checked", model: "m", provider: "Anthropic" });
    await setPolicy(t.db, agent.id, [{ tool: "list_notes", action: "list", effect: "allow" }, { tool: "write_note", action: "create", effect: "approve" }], "enforce");
    // PostgreSQL itself refuses writes in the transaction the live checks use.
    await assert.rejects(t.db.tx(async (q) => { await q.run("SET TRANSACTION READ ONLY"); await q.run("INSERT INTO meta (key, value) VALUES ('x', 'y')"); }), /read-only/i);

    const tables = ["agents", "events", "reviews", "authorizations", "asks", "meta", "verification_runs"];
    const counts = async () => Object.fromEntries(await Promise.all(tables.map(async (n) => [n, await count(t.db, `SELECT COUNT(*)::int AS n FROM ${n}`)])));
    const before = await counts();
    const run = await runVerification(t.db, agent.id, "0123456789abcdef", { notesDir: dir });
    const after = await counts();
    assert.deepEqual({ ...after, events: after.events - 1, verification_runs: after.verification_runs - 1 }, before, "nothing but the run's own result and audit event was written");
    assert.deepEqual(run.checks.filter((c) => c.group === "isolated").map((c) => c.status), ["verified", "verified", "verified", "verified", "verified"]);
    assert.equal(run.checks.find((c) => c.id === "folder_closed")!.status, "verified");
    assert.deepEqual(await latestVerification(t.db, agent.id), JSON.parse(JSON.stringify(run)));
    assert.equal(await sqlState(() => t.db.run("UPDATE verification_runs SET results = '{}'")), "42501");
    assert.equal(await sqlState(() => t.db.run("DELETE FROM verification_runs")), "42501");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await t.close();
  }
});

test("central policy on a real pool: one change races live requests from two agents; each decision matches exactly one version, and the audit agrees", { skip }, async () => {
  const t = await tempDb();
  try {
    const regs = [await registerAgent(t.db, { name: "Claude agent", model: "m", provider: "Anthropic" }), await registerAgent(t.db, { name: "OpenAI agent", model: "m", provider: "OpenAI" })];
    const cp = await createCentralPolicy(t.db, { name: "Baseline", rules: [{ tool: "send_email", action: "send", effect: "allow" }] });
    await assignCentralPolicy(t.db, cp.id, { assign: regs.map((r) => r.agent.id) });
    const agents = await Promise.all(regs.map((r) => getAgent(t.db, r.agent.id)));
    const ask = (i: number, k: number) => requestAuthorization(t.db, agents[i]!, { tool: "send_email", action: "send", resource: `m-${i}-${k}` }, null).then((r) => r.view);
    // Ten requests per agent, launched together with one change from allow to deny, all overlapping on the pool.
    const work = [...Array.from({ length: 10 }, (_, k) => ask(0, k)), ...Array.from({ length: 10 }, (_, k) => ask(1, k))];
    const [changed, ...views] = await Promise.all([updateCentralPolicy(t.db, cp.id, { rules: [{ tool: "send_email", action: "send", effect: "deny" }] }), ...work]);
    assert.equal(changed.version, 2);
    const rows = await t.db.all<{ seq: number; agent_id: string; type: string; data: unknown }>(
      "SELECT seq, agent_id, type, data FROM events WHERE type IN ('policy.central_updated', 'authorization.requested', 'authorization.denied') ORDER BY seq");
    const data = (r: { data: unknown }) => (typeof r.data === "string" ? JSON.parse(r.data) : r.data) as Record<string, unknown>;
    const change = rows.filter((r) => r.type === "policy.central_updated");
    assert.equal(change.length, 2, "the change reached both agents");
    assert.equal(change[1].seq - change[0].seq, 1, "and landed on both in one step: nothing in between");
    for (const r of rows.filter((x) => x.type !== "policy.central_updated")) {
      const d = data(r), before = r.seq < change[0].seq;
      assert.equal(r.type, before ? "authorization.requested" : "authorization.denied", `${d.resource}: decided by the version in force at its turn`);
      assert.equal(d.centralVersion, before ? 1 : 2, `${d.resource}: and says which version decided it`);
    }
    // Whatever was allowed before the change can no longer be used after it.
    for (const v of views.filter((x) => x.status === "approved")) {
      const agent = agents.find((a) => a!.id === (v as { agentId?: string }).agentId) ?? agents[Number(String(v.resource).split("-")[1])]!;
      await assert.rejects(() => claimToken(t.db, agent, v.id), (e: { status?: number; code?: string }) => e.status === 403 && e.code === "not_permitted");
    }
  } finally {
    await t.close();
  }
});

test("central policy on a real pool: five operators save from the same version at once; exactly one wins and only its rules are in force", { skip }, async () => {
  const t = await tempDb();
  try {
    const reg = await registerAgent(t.db, { name: "OpenAI agent", model: "m", provider: "OpenAI" });
    const cp = await createCentralPolicy(t.db, { name: "Baseline", rules: [{ tool: "send_email", action: "send", effect: "approve" }] });
    await assignCentralPolicy(t.db, cp.id, { assign: [reg.agent.id] });
    const effects = ["allow", "deny", "approve", "deny", "allow"] as const;
    const results = await Promise.allSettled(effects.map((effect, i) => updateCentralPolicy(t.db, cp.id, { rules: [{ tool: "send_email", action: "send", effect }], expectedVersion: 1 }, `operator-${i}`)));
    const won = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof updateCentralPolicy>>>[];
    assert.equal(won.length, 1, "one save wins");
    for (const r of results.filter((x) => x.status === "rejected") as PromiseRejectedResult[]) assert.equal((r.reason as { code?: string }).code, "policy_changed");
    const agent = (await getAgent(t.db, reg.agent.id))!;
    const v = (await requestAuthorization(t.db, agent, { tool: "send_email", action: "send", resource: "m-1" }, null)).view;
    const expected = { allow: "approved", approve: "pending", deny: "denied" }[won[0].value.rules[0].effect as "allow" | "approve" | "deny"];
    assert.equal(v.status, expected, "a request afterwards is judged by the winner's rules");
    assert.equal((await t.db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM events WHERE type = 'policy.central_updated'"))!.n, 1, "and only the winner was recorded");
  } finally {
    await t.close();
  }
});

test("time limits work through a transaction-pooling proxy: no startup parameter is sent, each transaction sets its own, and a stuck query fails closed", { skip }, async () => {
  const before = process.env.TEND_DB_TIMEOUT_MS;
  process.env.TEND_DB_TIMEOUT_MS = "300";
  const t = await tempDb();
  try {
    // PgBouncer (Neon's pooled connections) refuses unknown startup parameters: none may be set on the connection itself.
    assert.equal((await t.db.get<{ statement_timeout: string }>("SHOW statement_timeout"))!.statement_timeout, "0", "nothing set at connection level");
    assert.equal(await t.db.tx(async (q) => (await q.get<{ statement_timeout: string }>("SHOW statement_timeout"))!.statement_timeout), "300ms", "set inside the transaction");
    const started = Date.now();
    assert.equal(await sqlState(() => t.db.tx((q) => q.get("SELECT pg_sleep(5)"))), "57014", "a stuck statement in a transaction is cancelled by the server");
    assert.notEqual(await sqlState(() => t.db.get("SELECT pg_sleep(5)")), "ok", "a stuck single query is abandoned by the client limit");
    assert.ok(Date.now() - started < 4_000, "both within the limit, not after the full sleep");
    const agent = await agentWithPolicy(t.db);
    await setPolicy(t.db, agent.id, [{ tool: "t", action: "a", effect: "allow" }], "enforce");
    const holder = t.db.tx(async (q) => { await q.lockEvents(); await q.get("SELECT pg_sleep(0.25)"); });
    const asked = await sqlState(() => requestAuthorization(t.db, agent, { tool: "t", action: "a" }, null));
    await holder.catch(() => {});
    assert.ok(asked === "ok" || asked === "57014", `either it waited for the lock within the limit or was cancelled (${asked})`);
    assert.equal(await count(t.db, "SELECT COUNT(*)::int AS n FROM authorizations WHERE status = 'consumed'"), 0, "nothing was spent either way");
  } finally {
    await t.close();
    if (before === undefined) delete process.env.TEND_DB_TIMEOUT_MS; else process.env.TEND_DB_TIMEOUT_MS = before;
  }
});

test("an instance on schema 9 with data (what the current beta deployment runs) upgrades in place: nothing lost, all in the default workspace", { skip }, async () => {
  assertLocal(URL_);
  const admin = new pg.Client({ connectionString: URL_ });
  await admin.connect();
  const name = `tend_test_${randomBytes(6).toString("hex")}`;
  await admin.query(`CREATE DATABASE ${name}`);
  const u = new URL(URL_);
  u.pathname = `/${name}`;
  const db = await postgres(u.toString());
  try {
    // The old schema, exactly as migrations 1-9 left it, with a little history in it.
    await db.tx(async (q) => {
      await q.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at BIGINT NOT NULL)");
      for (let i = 0; i < 9; i++) { await q.exec(MIGRATIONS[i]); await q.run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", i + 1, Date.now()); }
      await q.run("INSERT INTO agents (id, profile, origin, created_at) VALUES ('old-agent', ?, 'connected', ?)", JSON.stringify({ name: "Old", model: "m", provider: "Custom", role: "r", description: "", cadenceHours: 0 }), Date.now());
      await q.run("INSERT INTO central_policies (id, name, policy, version, created_at, updated_at) VALUES ('cp_old', 'Baseline', '[]', 1, 0, 0)");
      await q.run("INSERT INTO events (id, agent_id, type, at, actor) VALUES ('ev_old', 'old-agent', 'agent.registered', 1, 'human')");
    });
    await migrate(db);
    assert.equal((await db.get<{ v: number }>("SELECT MAX(version) AS v FROM schema_migrations"))!.v, MIGRATIONS.length);
    assert.equal((await db.get<{ workspace_id: string }>("SELECT workspace_id FROM agents WHERE id = 'old-agent'"))!.workspace_id, "default");
    assert.equal((await db.get<{ workspace_id: string }>("SELECT workspace_id FROM central_policies WHERE id = 'cp_old'"))!.workspace_id, "default");
    assert.equal(await count(db, "SELECT COUNT(*)::int AS n FROM events"), 1, "history kept");
    // A new workspace may reuse the old policy name, and new events join the hash chain after the old, unhashed ones.
    await db.run("INSERT INTO workspaces (id, name, created_at) VALUES ('ws_new', 'n', 0)");
    await db.run("INSERT INTO central_policies (id, name, policy, version, created_at, updated_at, workspace_id) VALUES ('cp_new', 'Baseline', '[]', 1, 0, 0, 'ws_new')");
    await setPolicy(db, "old-agent", [{ tool: "t", action: "call", effect: "allow" }], "enforce");
    const { verifyAudit } = await import("./audit-chain.ts");
    const v = await verifyAudit(db);
    assert.equal(v.ok, true);
    assert.equal(v.checked, 1, "the old event is before the chain; the new one starts it");
    await migrate(db); // running again changes nothing
  } finally {
    await db.close();
    await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
    await admin.end();
  }
});
