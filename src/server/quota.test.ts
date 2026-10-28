// Regression tests for audit F-02 / risk R-01: one agent key must not be able to fill the database or bury real approvals.
// Before the fix, 130 batches of 50 review requests stored 6,001 events and 6,000 pending reviews from one key, inside the
// existing rate limits (reproduced; see docs/security-risk-register.md). Each test here fails on that code.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { PROTOCOL } from "../lib/contract.ts";
import { authAgent } from "./agent-auth.ts";
import { requestAuthorization } from "./authz.ts";
import { memoryDb, type DB } from "./db.ts";
import { HttpError, route, spend } from "./http.ts";
import { decide, getAgent, ingestCheckIn, ingestEvents, QUOTA, registerAgent, setPolicy } from "./repo.ts";

process.env.TEND_ADMIN_TOKEN = "test-admin-token-0123456789abcdef";
process.env.TEND_DEMO = "0";

const DEFAULTS = { ...QUOTA };
const bearer = (key: string) => new Request("http://tend.test/", { headers: { authorization: `Bearer ${key}` } });
const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpError) return e;
    throw e;
  }
  return assert.fail("expected a refusal");
};
const count = async (db: DB, sql: string, ...p: unknown[]) => (await db.get<{ n: number }>(sql, ...p))!.n;
const events = (db: DB, agentId: string) => count(db, "SELECT COUNT(*)::int AS n FROM events WHERE agent_id = ? AND type <> 'agent.registered'", agentId);
const pending = (db: DB, agentId: string) => count(db, "SELECT COUNT(*)::int AS n FROM reviews WHERE agent_id = ? AND status = 'pending'", agentId);
const tasks = (n: number, tag = "t") => Array.from({ length: n }, (_, i) => ({ type: "task.started", data: { taskId: `${tag}${i}`, title: "work" } }));
const asks = (n: number) => Array.from({ length: n }, (_, i) => ({ type: "review.requested", data: { reason: `look at ${i}` } }));

async function fixture(name = "Looper") {
  const db = await memoryDb();
  const mk = async (n: string) => {
    const { agent, apiKey } = await registerAgent(db, { name: n, model: "m", provider: "Custom" });
    return { id: agent.id, key: apiKey, live: async () => (await getAgent(db, agent.id))! };
  };
  return { db, a: await mk(name), b: await mk("Bystander"), mk };
}
/** Sends through the same path as the route: key, per-agent rate limit, then ingestion. */
const send = async (db: DB, key: string, batch: object[]) => ingestEvents(db, await authAgent(db, bearer(key)), batch);
const restore = () => Object.assign(QUOTA, DEFAULTS);
/** Counting tests must not straddle a minute boundary: the clock stands still at the middle of a minute. */
const frozen = (t: TestContext) => t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2030, 0, 1, 10, 0, 30) });

test("the reproduction: 130 requests of 50 events from one key, inside every other limit, store at most one minute's allowance", async (t: TestContext) => {
  frozen(t);
  const { db, a } = await fixture();
  try {
    let accepted = 0;
    const refused: HttpError[] = [];
    for (let i = 0; i < 130; i++) {
      try {
        await send(db, a.key, tasks(50, `r${i}-`));
        accepted++;
      } catch (e) {
        if (!(e instanceof HttpError)) throw e;
        refused.push(e);
      }
    }
    assert.equal(accepted, QUOTA.eventsPerMinute / 50, "exactly the allowance, not one request more");
    assert.equal(await events(db, a.id), QUOTA.eventsPerMinute, "and that is what is stored");
    const quota = refused.filter((e) => e.code === "agent_quota_exceeded");
    assert.deepEqual([refused.length - quota.length, quota.length], [10, 108], "ten were stopped by the old per-minute request limit; the other 108 only by the per-agent allowance");
    assert.deepEqual([quota[0].status, quota[0].extra?.quota, quota[0].extra?.limit], [429, "events_per_minute", 600]);
    assert.ok(Number(quota[0].extra?.retryAfter) >= 1 && Number(quota[0].extra?.retryAfter) <= 60, "it says when to come back");
  } finally {
    await db.close();
  }
});

test("a batch that does not fit is refused whole; nothing of it is stored, and a smaller one is still welcome until the allowance is gone", async (t: TestContext) => {
  frozen(t);
  const { db, a } = await fixture();
  QUOTA.eventsPerMinute = 100;
  try {
    await send(db, a.key, tasks(50, "a"));
    await send(db, a.key, tasks(40, "b"));
    assert.equal(await events(db, a.id), 90);
    const e = await refusal(send(db, a.key, tasks(11, "c")));
    assert.equal(e.code, "agent_quota_exceeded");
    assert.equal(await events(db, a.id), 90, "not one of the 11 was kept");
    // The refused request still counted against the window (it keeps refusing), so even one more event does not slip in.
    assert.equal((await refusal(send(db, a.key, tasks(1, "d")))).code, "agent_quota_exceeded");
    assert.equal(await events(db, a.id), 90);
  } finally {
    restore();
    await db.close();
  }
});

test("presence pings and malformed requests cost nothing, and an oversized batch is refused before any allowance is touched", async (t: TestContext) => {
  frozen(t);
  const { db, a } = await fixture();
  QUOTA.eventsPerMinute = 10;
  try {
    for (let i = 0; i < 100; i++) await send(db, a.key, [{ type: "agent.heartbeat" }]).catch((e) => { if (!(e instanceof HttpError && e.code === "rate_limited")) throw e; });
    for (let i = 0; i < 5; i++) assert.equal((await refusal(ingestEvents(db, (await a.live()), [{ type: "nonsense" }]))).code, "invalid_event");
    assert.equal((await refusal(ingestEvents(db, await a.live(), tasks(51)))).code, "invalid_batch");
    assert.equal((await refusal(ingestEvents(db, await a.live(), []))).code, "invalid_batch");
    await ingestEvents(db, await a.live(), tasks(10, "all"));
    assert.equal(await events(db, a.id), 10, "the whole allowance was still there");
  } finally {
    restore();
    await db.close();
  }
});

test("one agent's flood leaves another agent's allowance alone, and the allowance cannot be spent in another agent's name", async (t: TestContext) => {
  frozen(t);
  const { db, a, b } = await fixture();
  QUOTA.eventsPerMinute = 50;
  try {
    await send(db, a.key, tasks(50, "a"));
    assert.equal((await refusal(send(db, a.key, tasks(1, "a2")))).code, "agent_quota_exceeded");
    await send(db, b.key, tasks(50, "b"));
    assert.equal(await events(db, b.id), 50);
    // The body cannot name another agent: ingestion takes the agent from the key and ignores anything else.
    await refusal(send(db, b.key, [{ type: "task.started", agentId: a.id, data: { taskId: "x", title: "x", agentId: a.id } }]));
    assert.equal(await events(db, a.id), 50, "A's count did not move");
  } finally {
    restore();
    await db.close();
  }
});

test("the allowance frees up when the window ends: a minute for the minute budget, a day for the daily one", async (t: TestContext) => {
  const { db, a } = await fixture();
  QUOTA.eventsPerMinute = 50;
  QUOTA.eventsPerDay = 80;
  const T = Date.UTC(2030, 0, 1, 10, 0, 5);
  t.mock.timers.enable({ apis: ["Date"], now: T });
  try {
    await send(db, a.key, tasks(50, "m1"));
    assert.equal((await refusal(send(db, a.key, tasks(1, "x")))).extra?.quota, "events_per_minute");
    t.mock.timers.tick(61_000);
    await send(db, a.key, tasks(30, "m2")); // 80 so far today
    t.mock.timers.tick(61_000);
    const e = await refusal(send(db, a.key, tasks(1, "x2")));
    assert.equal(e.extra?.quota, "events_per_day", "the minute is free but the day is not");
    assert.ok(Number(e.extra?.retryAfter) > 3_600, "and the answer says it is hours away, not seconds");
    t.mock.timers.tick(6 * 3_600_000);
    await refusal(send(db, a.key, tasks(1, "x3")));
    t.mock.timers.tick(15 * 3_600_000); // past midnight UTC
    await send(db, a.key, tasks(50, "next-day"));
    assert.equal(await events(db, a.id), 130);
  } finally {
    restore();
    await db.close();
  }
});

test("the limiter's cleanup removes ended windows only: a live daily counter survives it", async (t: TestContext) => {
  const db = await memoryDb();
  const T = Date.UTC(2030, 0, 1, 10, 0, 0);
  try {
    t.mock.method(Math, "random", () => 0); // run the cleanup on every call
    assert.equal((await spend(db, "k:day", 100, { windowMs: 86_400_000, cost: 60, now: T })).ok, true);
    assert.equal((await spend(db, "k:min", 100, { now: T })).ok, true);
    // Three hours and many cleanups later: the minute row is long gone, the day row still counts.
    for (const hours of [1, 2, 3]) await spend(db, "other", 5, { now: T + hours * 3_600_000 });
    assert.equal((await spend(db, "k:day", 100, { windowMs: 86_400_000, cost: 50, now: T + 3 * 3_600_000 })).ok, false, "60 + 50 > 100: the earlier spend was remembered");
    assert.equal(await count(db, "SELECT COUNT(*)::int AS n FROM rate_limits WHERE key = 'k:min'"), 0, "the ended minute was cleaned up");
    // Existing behaviour is untouched: a minute window is identified by its own minute.
    const row = await db.get<{ bucket: number }>("SELECT bucket FROM rate_limits WHERE key = 'other' ORDER BY bucket DESC LIMIT 1");
    assert.equal(row!.bucket, Math.floor((T + 3 * 3_600_000) / 60_000), "only the latest minute of 'other' is left; its own bucket is the minute it was counted in");
  } finally {
    await db.close();
  }
});

test("only a bounded number of requests can wait for a person, from every path that can open one", async () => {
  const { db, a, b } = await fixture();
  try {
    // Five from each of three sources: asking, a held tool call, and a check-in that proposes a change.
    await send(db, a.key, asks(5));
    await send(db, a.key, Array.from({ length: 5 }, (_, i) => ({ type: "tool.called", data: { tool: "mail", action: "send", outcome: "pending_approval", resource: `m${i}` } })));
    const checkIn = { protocol: PROTOCOL, responses: { instructions: { answer: "yes", confidence: 9 }, context: { answer: "yes", confidence: 9 }, conflicts: { answer: "no", confidence: 9 }, review: { answer: "yes", confidence: 9 }, improvements: { answer: "no", confidence: 9 } } };
    for (let i = 0; i < 5; i++) await ingestCheckIn(db, await a.live(), checkIn, "agent");
    assert.equal(await pending(db, a.id), 15);
    await send(db, a.key, asks(5));
    assert.equal(await pending(db, a.id), QUOTA.pendingReviews);

    const before = await events(db, a.id);
    for (const attempt of [
      () => send(db, a.key, [...tasks(3, "keep"), ...asks(1)]),
      () => send(db, a.key, [{ type: "tool.called", data: { tool: "mail", action: "send", outcome: "pending_approval", resource: "late" } }]),
      async () => ingestCheckIn(db, await a.live(), checkIn, "agent"),
    ]) {
      const e = await refusal(attempt());
      assert.deepEqual([e.status, e.code, e.extra?.limit], [429, "too_many_pending_reviews", 20]);
    }
    assert.equal(await events(db, a.id), before, "refused whole: the ordinary events that rode along were not kept either");
    assert.equal(await pending(db, a.id), 20);

    // Answering one frees exactly one place. Another agent never had a problem.
    const one = (await db.get<{ id: string }>("SELECT id FROM reviews WHERE agent_id = ? AND status = 'pending' ORDER BY id LIMIT 1", a.id))!.id;
    await decide(db, one, "rejected");
    await send(db, a.key, asks(1));
    assert.equal((await refusal(send(db, a.key, asks(1)))).code, "too_many_pending_reviews");
    await send(db, b.key, asks(20));
    assert.equal(await pending(db, b.id), 20);
  } finally {
    await db.close();
  }
});

test("an operator composing a check-in for an agent is not an agent's key: neither its allowance nor its review cap applies", async () => {
  const { db, a } = await fixture();
  QUOTA.eventsPerMinute = 1;
  QUOTA.pendingReviews = 1;
  try {
    const checkIn = { protocol: PROTOCOL, responses: { instructions: { answer: "yes", confidence: 9 }, context: { answer: "yes", confidence: 9 }, conflicts: { answer: "no", confidence: 9 }, review: { answer: "yes", confidence: 9 }, improvements: { answer: "no", confidence: 9 } } };
    for (let i = 0; i < 3; i++) await ingestCheckIn(db, await a.live(), checkIn, "human");
    assert.equal(await pending(db, a.id), 3);
  } finally {
    restore();
    await db.close();
  }
});

test("denied and allowed authorization requests are both capped per day, so a refused flood cannot fill the table either", async (t: TestContext) => {
  frozen(t);
  const { db, a, b } = await fixture();
  QUOTA.authorizationsPerDay = 6;
  try {
    await setPolicy(db, a.id, [{ tool: "t", action: "ok", effect: "allow" }], "enforce");
    await setPolicy(db, b.id, [{ tool: "t", action: "ok", effect: "allow" }], "enforce");
    const ask = async (who: typeof a, action: string) => (await requestAuthorization(db, await who.live(), { tool: "t", action }, null)).view.status;
    const statuses = [] as string[];
    for (let i = 0; i < 3; i++) statuses.push(await ask(a, "ok"), await ask(a, "forbidden"));
    assert.deepEqual(statuses, ["approved", "denied", "approved", "denied", "approved", "denied"]);
    const e = await refusal(ask(a, "forbidden"));
    assert.deepEqual([e.status, e.code, e.extra?.quota], [429, "agent_quota_exceeded", "authorizations_per_day"]);
    assert.equal(await count(db, "SELECT COUNT(*)::int AS n FROM authorizations WHERE agent_id = ?", a.id), 6, "nothing beyond the cap was stored");
    assert.equal(await ask(b, "ok"), "approved", "another agent is not affected");
  } finally {
    restore();
    await db.close();
  }
});

test("parallel requests cannot overspend: 40 batches at once admit exactly the allowance, and 40 review requests exactly the cap", async (t: TestContext) => {
  frozen(t);
  const { db, a, b } = await fixture();
  try {
    const agent = await a.live();
    const flood = await Promise.allSettled(Array.from({ length: 40 }, (_, i) => ingestEvents(db, agent, tasks(50, `p${i}-`))));
    assert.equal(flood.filter((r) => r.status === "fulfilled").length, QUOTA.eventsPerMinute / 50);
    assert.equal(await events(db, a.id), QUOTA.eventsPerMinute);
    const bAgent = await b.live();
    const reviews = await Promise.allSettled(Array.from({ length: 40 }, () => ingestEvents(db, bAgent, asks(1))));
    assert.equal(reviews.filter((r) => r.status === "fulfilled").length, QUOTA.pendingReviews);
    assert.equal(await pending(db, b.id), QUOTA.pendingReviews);
    assert.ok(reviews.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason?.code === "too_many_pending_reviews"));
  } finally {
    await db.close();
  }
});

test("a 429 from a quota tells the client when to retry; other 429s keep the short default", async () => {
  const handler = (extra?: Record<string, unknown>) => route(async () => { throw new HttpError(429, "x", "slow", extra); })(new Request("http://x/"), undefined);
  assert.equal((await handler({ retryAfter: 3600 })).headers.get("retry-after"), "3600");
  assert.equal((await handler()).headers.get("retry-after"), "10");
});
