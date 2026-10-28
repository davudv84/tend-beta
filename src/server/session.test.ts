// Risk R-02: operator sessions on the server, and the authentication log.
// Before this, a session was a signed cookie nobody could revoke, and sign-ins, failures and sign-outs left no trace.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { checkAdminToken } from "./auth.ts";
import { memoryDb, type DB, type Q } from "./db.ts";
import { HttpError, requireOperator } from "./http.ts";
import { activeSession, audit, createSession, isOperator, revokeAll, SESSION_TTL, sessionCookieName, sessionHeader, sessionOverview, signOut, viewerOf } from "./session.ts";
import { FAILURES_PER_MINUTE, SIGNINS_PER_MINUTE, signIn } from "./signin.ts";
import { signedIn } from "./test-support.ts";

const TOKEN = "test-admin-token-0123456789abcdef";
const WRONG = "WRONG-TOKEN-CANARY-9f3a1c77d2e84b";
process.env.TEND_ADMIN_TOKEN = TOKEN;
process.env.TEND_DEMO = "0";
delete process.env.TEND_TRUSTED_PROXY;
delete process.env.VERCEL;

const withCookie = (value: string, headers: Record<string, string> = {}) => new Request("http://tend.test/api/v1/x", { method: "POST", headers: { host: "tend.test", cookie: `${sessionCookieName()}=${value}`, ...headers } });
const fromAddress = (ip: string, headers: Record<string, string> = {}) => new Request("http://tend.test/api/operator/session", { method: "POST", headers: { host: "tend.test", "x-forwarded-for": `1.1.1.1, ${ip}`, ...headers } });
const anonymous = () => new Request("http://tend.test/api/operator/session", { method: "POST", headers: { host: "tend.test" } });
const count = async (db: Q, sql: string, ...p: unknown[]) => (await db.get<{ n: number }>(sql, ...p))!.n;
const types = async (db: Q) => (await db.all<{ type: string }>("SELECT type FROM auth_events ORDER BY seq")).map((r) => r.type);
const noWait = async () => {};
const refused = (p: Promise<unknown>, status: number, code?: string) => assert.rejects(p, (e) => e instanceof HttpError && e.status === status && (!code || e.code === code));
const withTrust = async (hops: string | undefined, fn: () => Promise<void>) => {
  const before = process.env.TEND_TRUSTED_PROXY;
  if (hops === undefined) delete process.env.TEND_TRUSTED_PROXY; else process.env.TEND_TRUSTED_PROXY = hops;
  try { await fn(); } finally { if (before === undefined) delete process.env.TEND_TRUSTED_PROXY; else process.env.TEND_TRUSTED_PROXY = before; }
};
const dump = async (db: Q) => JSON.stringify({
  sessions: await db.all("SELECT * FROM operator_sessions"), log: await db.all("SELECT * FROM auth_events"), limits: await db.all("SELECT * FROM rate_limits"),
});

// ---- revocation ---------------------------------------------------------------------------------------------------

test("signing out revokes the session on the server: the same cookie, replayed afterwards, gets nothing", async () => {
  const db = await memoryDb();
  try {
    const me = await signedIn(db);
    assert.equal(await isOperator(db, me.request()), true);
    assert.equal(await signOut(db, me.request(), Date.now()), true);
    for (let i = 0; i < 3; i++) {
      assert.equal(await isOperator(db, me.request()), false, "replay of a signed-out cookie");
      await assert.rejects(() => requireOperator(me.request(), db), (e) => e instanceof HttpError && e.status === 403 && e.code === "operator_required");
    }
    assert.equal((await viewerOf(db, me.request())).canAct, false);
    assert.equal(await signOut(db, me.request(), Date.now()), false, "signing out twice does nothing");
    assert.equal((await types(db)).filter((t) => t === "session.signed_out").length, 1, "and is recorded once");
  } finally {
    await db.close();
  }
});

test("an id alone cannot sign anyone out, and a stolen cookie for one session cannot touch another", async () => {
  const db = await memoryDb();
  try {
    const a = await signedIn(db), b = await signedIn(db);
    assert.equal(await signOut(db, withCookie(a.id), Date.now()), false, "the id is not a credential (it is written into the activity log)");
    assert.equal(await signOut(db, withCookie(`${a.id}.${"A".repeat(43)}`), Date.now()), false, "a guessed secret does nothing");
    assert.equal(await signOut(db, withCookie(`${a.id}.${b.value.split(".")[1]}`), Date.now()), false, "another session's secret does nothing");
    assert.equal(await isOperator(db, a.request()), true);
    assert.equal(await isOperator(db, b.request()), true);
  } finally {
    await db.close();
  }
});

test("'sign out everywhere' ends every live session at once, this one included, and a fresh sign-in still works", async () => {
  const db = await memoryDb();
  try {
    const sessions = await Promise.all([signedIn(db), signedIn(db), signedIn(db)]);
    const done = await signedIn(db);
    await signOut(db, done.request());
    assert.equal(await revokeAll(db, sessions[0].id), 3, "only the live ones are counted");
    for (const s of sessions) assert.equal(await isOperator(db, s.request()), false);
    assert.deepEqual((await sessionOverview(db, sessions[0].id)).sessions, []);
    const again = await signIn(db, anonymous(), { token: TOKEN });
    assert.equal(await isOperator(db, withCookie(again.value)), true, "the token is still the way back in");
    assert.equal(await isOperator(db, sessions[1].request()), false, "and the old ones stay dead");
    assert.ok((await types(db)).includes("session.revoked_all"));
  } finally {
    await db.close();
  }
});

test("revocation is immediate under concurrency: no check that starts after it finishes succeeds, and parallel sign-outs end it once", async () => {
  const db = await memoryDb();
  try {
    const me = await signedIn(db), other = await signedIn(db);
    // Requests racing the revocation may land on either side of it; those that begin afterwards must all be refused.
    const during = Promise.all(Array.from({ length: 20 }, () => isOperator(db, me.request())));
    const revoked = revokeAll(db, other.id);
    await Promise.all([during, revoked]);
    const after = await Promise.all(Array.from({ length: 40 }, () => isOperator(db, me.request())));
    assert.equal(after.some(Boolean), false);

    const third = await signedIn(db);
    const results = await Promise.all(Array.from({ length: 12 }, () => signOut(db, third.request(), Date.now())));
    assert.equal(results.filter(Boolean).length, 1, "exactly one sign-out wins");
    assert.equal((await db.all("SELECT 1 FROM auth_events WHERE type = 'session.signed_out' AND session_id = ?", third.id)).length, 1);
  } finally {
    await db.close();
  }
});

test("signing in again replaces the session the browser already held", async () => {
  const db = await memoryDb();
  try {
    const old = await signedIn(db);
    const fresh = await signIn(db, new Request("http://tend.test/api/operator/session", { method: "POST", headers: { host: "tend.test", cookie: old.cookie } }), { token: TOKEN });
    assert.notEqual(fresh.id, old.id);
    assert.equal(await isOperator(db, old.request()), false);
    assert.equal(await isOperator(db, withCookie(fresh.value)), true);
  } finally {
    await db.close();
  }
});

// ---- expiry -------------------------------------------------------------------------------------------------------

test("an expired session is always refused, to the millisecond, however valid everything else is", async () => {
  const db = await memoryDb();
  try {
    const t0 = Date.UTC(2030, 0, 1, 8, 0, 0);
    const s = await signedIn(db, { now: t0 });
    assert.equal(SESSION_TTL, 12 * 3_600_000);
    assert.equal(await activeSession(db, s.request(), t0 + SESSION_TTL - 1), s.id, "one millisecond before the end it still works");
    assert.equal(await activeSession(db, s.request(), t0 + SESSION_TTL), undefined, "at the end it does not");
    assert.equal(await activeSession(db, s.request(), t0 + SESSION_TTL + 1), undefined);
    assert.equal(await count(db, "SELECT COUNT(*)::int AS n FROM auth_events WHERE type = 'session.rejected' AND reason = 'expired'"), 1, "the first use after expiry is noted, once");
    assert.equal(await activeSession(db, s.request(), t0 + 10 * SESSION_TTL), undefined, "and never again");
    // The stored expiry is what counts: nothing the browser sends can extend it.
    assert.equal(Number((await db.get<{ expires_at: number }>("SELECT expires_at FROM operator_sessions WHERE id = ?", s.id))!.expires_at), t0 + SESSION_TTL);
  } finally {
    await db.close();
  }
});

test("using a session does not extend it, and the cookie's lifetime matches the server's", async () => {
  const db = await memoryDb();
  try {
    const t0 = Date.UTC(2030, 0, 1, 8, 0, 0);
    const s = await signedIn(db, { now: t0 });
    for (let h = 1; h < 12; h++) assert.equal(await activeSession(db, s.request(), t0 + h * 3_600_000), s.id);
    assert.equal(await activeSession(db, s.request(), t0 + SESSION_TTL), undefined);
    assert.match(sessionHeader(s.value, SESSION_TTL), /Max-Age=43200(;|$)/);
  } finally {
    await db.close();
  }
});

// ---- the token itself ---------------------------------------------------------------------------------------------

test("a session secret is 256 random bits, never repeats, and only its hash is kept", async () => {
  const db = await memoryDb();
  try {
    const made = [] as Awaited<ReturnType<typeof signedIn>>[];
    for (let i = 0; i < 150; i++) made.push(await signedIn(db));
    assert.equal(new Set(made.map((m) => m.id)).size, 150);
    assert.equal(new Set(made.map((m) => m.value.split(".")[1])).size, 150);
    for (const m of made) {
      const [id, secret] = m.value.split(".");
      assert.match(id, /^[a-f0-9]{16}$/);
      assert.match(secret, /^[A-Za-z0-9_-]{43}$/, "43 base64url characters are 256 bits");
    }
    const stored = JSON.stringify(await db.all("SELECT * FROM operator_sessions"));
    for (const m of made.slice(0, 20)) assert.equal(stored.includes(m.value.split(".")[1]), false, "no secret is stored");
    const [id, secret] = made[0].value.split(".");
    assert.equal((await db.get<{ secret_hash: string }>("SELECT secret_hash FROM operator_sessions WHERE id = ?", id))!.secret_hash, createHash("sha256").update(secret).digest("hex"));
    assert.equal(stored.includes(TOKEN), false, "and nothing derived from the admin token that could be used to sign in");
  } finally {
    await db.close();
  }
});

test("forged, truncated, swapped, oversized and malformed cookies are refused quietly, and never cause a server error", async () => {
  const db = await memoryDb();
  try {
    const a = await signedIn(db), b = await signedIn(db);
    const [ida, sa] = a.value.split("."), [idb, sb] = b.value.split(".");
    const flip = (s: string) => s.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    const bad = [
      `${ida}.${flip(sa)}`, `${idb}.${sa}`, `${ida}.${sb}`, ida, sa, `${ida}.`, `.${sa}`, `${ida}.${sa}.x`, `${ida}.${sa.slice(0, 42)}`, `${ida}.${sa}A`,
      `${ida.toUpperCase()}.${sa}`, `${ida}.${"A".repeat(43)}`, `0000000000000000.${sa}`, "", " ", "undefined", "null", `${ida}%2E${sa}x`,
      "%E0%A4%A", "%", `${"a".repeat(10_000)}`, `${ida}.${"é".repeat(43)}`, `${Date.now() + 3_600_000}.${ida}.forged`,
    ];
    for (const value of bad) assert.equal(await isOperator(db, withCookie(value)), false, JSON.stringify(value).slice(0, 60));
    assert.equal(await isOperator(db, a.request()), true, "the real one is unaffected");
    // An unknown id says nothing; a known id with the wrong secret is worth a note, and only that.
    assert.equal(await count(db, "SELECT COUNT(*)::int AS n FROM auth_events WHERE reason = 'wrong_secret'"), 2, "one note per session (a and b) and reason, not one per attempt");
  } finally {
    await db.close();
  }
});

test("rotating the admin token ends every session for good: putting the old token back does not revive them", async () => {
  const db = await memoryDb();
  try {
    const me = await signedIn(db);
    process.env.TEND_ADMIN_TOKEN = "another-admin-token-0123456789abcdef";
    assert.equal(await isOperator(db, me.request()), false);
    process.env.TEND_ADMIN_TOKEN = TOKEN;
    assert.equal(await isOperator(db, me.request()), false, "once refused for this reason, refused for good");
    const reasons = (await db.all<{ reason: string }>("SELECT reason FROM auth_events WHERE type = 'session.rejected'")).map((r) => r.reason);
    assert.deepEqual(reasons, ["admin_token_changed", "revoked"]);
  } finally {
    process.env.TEND_ADMIN_TOKEN = TOKEN;
    await db.close();
  }
});

test("cookie settings: HttpOnly, SameSite=Strict, whole site, no Domain; in production also Secure and host-locked by the __Host- prefix", () => {
  const before = process.env.NODE_ENV;
  try {
    (process.env as Record<string, string>).NODE_ENV = "production";
    const prod = sessionHeader("abc", SESSION_TTL);
    assert.equal(sessionCookieName(), "__Host-tend_operator");
    assert.deepEqual(prod.split("; ").sort(), ["HttpOnly", "Max-Age=43200", "Path=/", "SameSite=Strict", "Secure", "__Host-tend_operator=abc"].sort());
    assert.equal(/Domain/i.test(prod), false, "a __Host- cookie must not name a domain");
    const cleared = sessionHeader("", 0);
    assert.match(cleared, /Max-Age=0/);
    assert.match(cleared, /Secure/);
    (process.env as Record<string, string>).NODE_ENV = "development";
    const dev = sessionHeader("abc", SESSION_TTL);
    assert.equal(sessionCookieName(), "tend_operator");
    assert.match(dev, /HttpOnly/);
    assert.match(dev, /SameSite=Strict/);
  } finally {
    if (before === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV; else (process.env as Record<string, string>).NODE_ENV = before;
  }
});

test("without a usable admin token no session is ever issued or accepted", async () => {
  const db = await memoryDb();
  try {
    const me = await signedIn(db);
    process.env.TEND_ADMIN_TOKEN = "short";
    assert.equal(await isOperator(db, me.request()), false);
    await assert.rejects(() => createSession(db), /no usable admin token/);
    await refused(signIn(db, anonymous(), { token: "short" }), 403, "operator_disabled");
    await refused(signIn(db, anonymous(), { token: "" }), 403, "operator_disabled");
    assert.ok((await types(db)).includes("signin.failed"));
  } finally {
    process.env.TEND_ADMIN_TOKEN = TOKEN;
    await db.close();
  }
});

// ---- the authentication log ---------------------------------------------------------------------------------------

test("every outcome is recorded, and neither a typed token nor a session secret appears anywhere in the database", async () => {
  const db = await memoryDb();
  try {
    await withTrust("1", async () => {
      await refused(signIn(db, fromAddress("203.0.113.5"), { token: WRONG }), 401, "invalid_token");
      await refused(signIn(db, fromAddress("203.0.113.5"), { token: 12345 }), 401);
      await refused(signIn(db, fromAddress("203.0.113.5"), undefined), 401);
      const s = await signIn(db, fromAddress("203.0.113.6"), { token: TOKEN });
      await signOut(db, withCookie(s.value), Date.now());
      assert.deepEqual(await types(db), ["signin.failed", "signin.failed", "signin.failed", "signin.succeeded", "session.signed_out"]);
      const rows = await db.all<{ type: string; session_id: string | null; client: string | null; reason: string | null }>("SELECT type, session_id, client, reason FROM auth_events ORDER BY seq");
      assert.deepEqual(rows.map((r) => r.reason), ["invalid_token", "malformed", "malformed", null, null]);
      assert.equal(rows[3].session_id, s.id);
      assert.equal(rows[3].client, "203.0.113.6", "the trusted address, not the forged one in front of it");
      const all = await dump(db);
      for (const secret of [WRONG, TOKEN, s.value.split(".")[1], s.value]) assert.equal(all.includes(secret), false, "a credential reached the database");
    });
  } finally {
    await db.close();
  }
});

test("the log is append-only: a row cannot be changed or removed by an ordinary statement", async () => {
  const db = await memoryDb();
  try {
    await audit(db, "signin.failed", { client: "x", reason: "invalid_token" });
    for (const sql of ["UPDATE auth_events SET reason = 'nothing'", "DELETE FROM auth_events", "TRUNCATE auth_events"])
      await assert.rejects(() => db.run(sql), (e) => (e as { code?: string }).code === "42501", sql);
    await assert.rejects(() => db.run("INSERT INTO auth_events (at, type) VALUES (1, 'made.up')"), (e) => (e as { code?: string }).code === "23514", "only known event types");
    assert.equal(await count(db, "SELECT COUNT(*)::int AS n FROM auth_events"), 1);
  } finally {
    await db.close();
  }
});

test("a revoked or expired session being presented again is noted once an hour, and an unknown id is not noted at all", async () => {
  const db = await memoryDb();
  try {
    const s = await signedIn(db);
    await signOut(db, s.request());
    for (let i = 0; i < 60; i++) await isOperator(db, s.request());
    assert.equal(await count(db, "SELECT COUNT(*)::int AS n FROM auth_events WHERE type = 'session.rejected'"), 1);
    for (let i = 0; i < 60; i++) await isOperator(db, withCookie(`${(i + 1).toString(16).padStart(16, "0")}.${"B".repeat(43)}`));
    assert.equal(await count(db, "SELECT COUNT(*)::int AS n FROM auth_events WHERE type = 'session.rejected'"), 1, "ids nobody was issued leave no trace, so they cannot be used to fill the log");
    const later = Date.now() + 2 * 3_600_000;
    await activeSession(db, s.request(), later);
    assert.equal(await count(db, "SELECT COUNT(*)::int AS n FROM auth_events WHERE type = 'session.rejected'"), 2, "an hour later it is worth saying again");
  } finally {
    await db.close();
  }
});

test("the operator's overview shows live sessions and recent activity, with nothing that could be used to sign in", async () => {
  const db = await memoryDb();
  try {
    const me = await signedIn(db, { client: "203.0.113.6" }), gone = await signedIn(db);
    await signOut(db, gone.request());
    await audit(db, "signin.failed", { client: "203.0.113.9", reason: "invalid_token" });
    const o = await sessionOverview(db, me.id);
    assert.deepEqual(o.sessions.map((s) => [s.id, s.current, s.client]), [[me.id, true, "203.0.113.6"]]);
    assert.ok(o.recent.length >= 2);
    const text = JSON.stringify(o);
    assert.equal(text.includes(me.value.split(".")[1]) || /secret_hash|epoch/.test(text), false);
  } finally {
    await db.close();
  }
});

test("sign-in activity is bounded however hard the endpoint is hit, and successes are never the ones dropped", async () => {
  const db = await memoryDb();
  try {
    const t = Date.UTC(2030, 0, 1, 10, 0, 30);
    await withTrust("1", async () => {
      for (let i = 0; i < 300; i++) await signIn(db, fromAddress(`198.51.100.${i % 250}`, { "x-note": String(i) }), { token: WRONG }, t, noWait).catch(() => {});
      const s = await signIn(db, fromAddress("203.0.113.77"), { token: TOKEN }, t);
      assert.ok(s.id);
    });
    const failures = await count(db, "SELECT COUNT(*)::int AS n FROM auth_events WHERE type IN ('signin.failed', 'signin.blocked')");
    assert.ok(failures <= 60, `${failures} failure rows from 300 attempts in one minute`);
    assert.equal(await count(db, "SELECT COUNT(*)::int AS n FROM auth_events WHERE type = 'log.suppressed'"), 1, "one line says that some were not written");
    assert.equal(await count(db, "SELECT COUNT(*)::int AS n FROM auth_events WHERE type = 'signin.succeeded'"), 1, "the success was written in the middle of the flood");
  } finally {
    await db.close();
  }
});

// ---- abuse protection, and no operator lock-out -------------------------------------------------------------------

test("a caller with a trusted address is refused after ten failures, correct token included, and nobody else is affected", async () => {
  const db = await memoryDb();
  try {
    await withTrust("1", async () => {
      const t = Date.UTC(2030, 0, 1, 10, 0, 30);
      // The attacker claims to be the operator's address in front of their own; only the address the proxy saw counts.
      const attacker = () => fromAddress("203.0.113.66", { "x-forwarded-for": "203.0.113.5, 203.0.113.66" });
      for (let i = 0; i < FAILURES_PER_MINUTE; i++) await refused(signIn(db, attacker(), { token: WRONG }, t), 401, "invalid_token");
      await assert.rejects(() => signIn(db, attacker(), { token: TOKEN }, t), (x) => x instanceof HttpError && x.status === 429 && Number(x.extra?.retryAfter) >= 1 && Number(x.extra?.retryAfter) <= 60);
      assert.equal(await count(db, "SELECT COUNT(*)::int AS n FROM auth_events WHERE type = 'signin.blocked'"), 1, "the block is recorded once, not once per refused attempt");
      // The operator, from their own address, is not touched by any of it — whatever the attacker claims to be.
      assert.ok((await signIn(db, fromAddress("203.0.113.5"), { token: TOKEN }, t)).id, "the address the attacker named is not the one that was counted");
      // The minute ends and the attacker may try again.
      assert.ok((await signIn(db, attacker(), { token: TOKEN }, t + 61_000)).id);
    });
  } finally {
    await db.close();
  }
});

test("where no address can be trusted nobody is refused: the correct token works in the middle of an attack, and wrong ones are only slowed", async () => {
  const db = await memoryDb();
  try {
    await withTrust(undefined, async () => {
      const t = Date.UTC(2030, 0, 1, 10, 0, 30);
      const delays: number[] = [];
      const wait = async (ms: number) => { delays.push(ms); };
      const outcomes: number[] = [];
      for (let i = 0; i < 60; i++) {
        if (i === 40) assert.ok((await signIn(db, anonymous(), { token: TOKEN }, t, wait)).id, "the operator gets in during the attack");
        await signIn(db, anonymous(), { token: WRONG }, t, wait).catch((e) => outcomes.push(e.status));
      }
      assert.deepEqual([...new Set(outcomes)], [401], "never a 429: nobody can be locked out");
      assert.deepEqual(delays.slice(0, FAILURES_PER_MINUTE), Array(FAILURES_PER_MINUTE).fill(0), "the first few cost nothing");
      assert.ok(delays.at(-1)! > 0 && delays.every((d) => d <= 2_000), "later ones are slowed, never by more than two seconds");
      assert.ok(delays.every((d, i) => i === 0 || d >= delays[i - 1]) , "and the more there have been, the longer");
    });
  } finally {
    await db.close();
  }
});

test("parallel wrong tokens from one caller: exactly ten are evaluated, the rest refused; correct tokens leave no failures behind and are limited by the sign-in allowance", async () => {
  const db = await memoryDb();
  try {
    await withTrust("1", async () => {
      const t = Date.UTC(2030, 0, 1, 10, 0, 30);
      const wrong = await Promise.allSettled(Array.from({ length: 40 }, () => signIn(db, fromAddress("203.0.113.66"), { token: WRONG }, t, noWait)));
      const codes = wrong.map((r) => (r.status === "rejected" ? (r.reason as HttpError).status : 200));
      assert.deepEqual([codes.filter((c) => c === 401).length, codes.filter((c) => c === 429).length], [FAILURES_PER_MINUTE, 30]);

      // Ten at once are all admitted (each is provisionally a failure until its token is checked) and all succeed, each with its own session.
      const burst = await Promise.allSettled(Array.from({ length: FAILURES_PER_MINUTE }, () => signIn(db, fromAddress("203.0.113.5"), { token: TOKEN }, t)));
      const ok = burst.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ id: string }>[];
      assert.equal(ok.length, FAILURES_PER_MINUTE);
      assert.equal(new Set(ok.map((r) => r.value.id)).size, FAILURES_PER_MINUTE);
      // Then the sign-in allowance is what limits them: thirty a minute in all.
      let more = 0;
      for (let i = 0; i < 25; i++) if (await signIn(db, fromAddress("203.0.113.5"), { token: TOKEN }, t).then(() => true, () => false)) more++;
      assert.equal(ok.length + more, SIGNINS_PER_MINUTE);
      assert.equal(await count(db, "SELECT COALESCE(SUM(n), 0)::int AS n FROM rate_limits WHERE key = 'signin:fail:203.0.113.5'"), 0, "correct sign-ins leave no failures behind");
      assert.equal(await count(db, "SELECT COUNT(*)::int AS n FROM auth_events WHERE type = 'signin.succeeded'"), SIGNINS_PER_MINUTE);
    });
  } finally {
    await db.close();
  }
});

test("an oversized or non-JSON body is not a free pass: through the route's rules it counts as a failed attempt", async () => {
  const db = await memoryDb();
  try {
    await withTrust("1", async () => {
      const t = Date.UTC(2030, 0, 1, 10, 0, 30);
      for (let i = 0; i < FAILURES_PER_MINUTE; i++) await refused(signIn(db, fromAddress("203.0.113.66"), undefined, t), 401);
      await refused(signIn(db, fromAddress("203.0.113.66"), { token: TOKEN }, t), 429);
    });
  } finally {
    await db.close();
  }
});

test("if the session store fails the request fails: a lookup error is never read as 'signed in', and a half-made session is never left behind", async () => {
  const db = await memoryDb();
  try {
    const me = await signedIn(db);
    let broken: RegExp | undefined;
    const wrap = (q: Q): Q => {
      const guard = (sql: string) => { if (broken?.test(sql)) throw new Error("simulated database failure"); };
      return { ...q, all: (s, ...p) => (guard(s), q.all(s, ...p)), get: (s, ...p) => (guard(s), q.get(s, ...p)), run: (s, ...p) => (guard(s), q.run(s, ...p)) } as Q;
    };
    const flaky = { ...wrap(db), kind: db.kind, tx: (fn: (q: Q) => Promise<unknown>) => db.tx((q) => fn(wrap(q))), close: () => db.close() } as DB;
    broken = /operator_sessions/;
    await assert.rejects(() => isOperator(flaky, me.request()), /simulated/);
    await assert.rejects(() => requireOperator(me.request(), flaky), /simulated/);
    await assert.rejects(() => viewerOf(flaky, me.request()), /simulated/);
    // Sign-in writes the session and its log line together: if the log cannot be written there is no session.
    broken = /INSERT INTO auth_events/;
    const before = await count(db, "SELECT COUNT(*)::int AS n FROM operator_sessions");
    await assert.rejects(() => signIn(flaky, anonymous(), { token: TOKEN }), /simulated/);
    assert.equal(await count(db, "SELECT COUNT(*)::int AS n FROM operator_sessions"), before, "no orphan session");
    // A failed attempt is still answered 401 when only the log is down.
    await refused(signIn(flaky, anonymous(), { token: WRONG }, Date.now(), noWait), 401, "invalid_token");
  } finally {
    await db.close();
  }
});

test("the admin token comparison and the old cookie format are unchanged and strict", () => {
  assert.equal(checkAdminToken(TOKEN), true);
  assert.equal(checkAdminToken(`${TOKEN} `), false);
  assert.equal(checkAdminToken(TOKEN.toUpperCase()), false);
  assert.equal(checkAdminToken(""), false);
});
