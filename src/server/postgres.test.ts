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
import { decide, getAgent, ingestEvents, QUOTA, registerAgent, revokeKey, setPolicy } from "./repo.ts";
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
