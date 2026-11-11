// The read-only demo account: created by its first sign-in, sample data only, every change refused, nothing of anyone else's visible.
// routes.test.ts makes sure every operator route calls requireOperator, so refusing there covers every route that changes anything.
import assert from "node:assert/strict";
import { test } from "node:test";
import { demoSignIn, hashPassword, passwordSignIn, register, requestReset, verifyEmail, setAccess } from "./accounts.ts";
import { memoryDb, type DB } from "./db.ts";
import { refreshDemo } from "./demo-account.ts";
import { requireOperator } from "./http.ts";
import { registerAgent } from "./repo.ts";
import { currentSession, sessionCookieName, sessionOverview, viewerOf } from "./session.ts";
import { snapshot } from "./sync.ts";

process.env.TEND_ADMIN_TOKEN = "t".repeat(8) + "0123456789abcdefghijklmnop";
process.env.TEND_DEMO = "0";
process.env.TEND_PUBLIC = "0";
process.env.TEND_TRUSTED_PROXY = "1";
delete process.env.TEND_ACCOUNTS;

const EMAIL = "yc-demo@tend-demo.local", PW = "YC-sample-password-for-tests", OTHER = "correct horse battery";
let ipn = 0;
const post = () => new Request("http://tend.test/api/account/x", { method: "POST", headers: { host: "tend.test", "x-forwarded-for": `10.2.0.${++ipn % 250}` } });
const as = (cookie: string, method = "GET") => new Request("http://tend.test/api/v1/x", { method, headers: { host: "tend.test", cookie: `${sessionCookieName()}=${cookie}` } });
const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };

async function demo(db: DB) {
  process.env.TEND_DEMO_ACCOUNT = `${EMAIL} ${await hashPassword(PW)}`;
  const s = await passwordSignIn(db, post(), { email: EMAIL, password: PW });
  return { cookie: s.value, session: (await currentSession(db, as(s.value)))! };
}

test("the first sign-in creates a read-only account whose workspace holds labelled sample agents, with no API keys", async () => {
  const db = await memoryDb();
  const { cookie, session } = await demo(db);
  assert.equal(session.readOnly, true);
  assert.equal((await viewerOf(db, as(cookie))).readOnly, true);
  const agents = await db.all<{ profile: string; key_hash: string | null; key_prefix: string | null; status: string; workspace_id: string }>("SELECT * FROM agents");
  assert.equal(agents.length, 4);
  for (const a of agents) {
    assert.match(JSON.parse(a.profile).name, /\(sample\)$/);
    assert.equal(a.key_hash, null, "no key exists for a sample agent");
    assert.equal(a.key_prefix, null);
    assert.equal(a.workspace_id, session.workspace);
  }
  assert.equal(agents.filter((a) => a.status === "paused").length, 1);
  const by = async (sql: string) => (await db.get<{ n: number }>(sql))!.n;
  assert.ok(await by("SELECT COUNT(*)::int AS n FROM authorizations WHERE status = 'consumed'") > 5, "allowed calls ran");
  assert.ok(await by("SELECT COUNT(*)::int AS n FROM authorizations WHERE status = 'denied'") >= 1, "refused calls are on record");
  assert.ok(await by("SELECT COUNT(*)::int AS n FROM authorizations WHERE status = 'pending'") >= 1, "a request waits for a person");
  assert.ok(await by("SELECT COUNT(*)::int AS n FROM events WHERE type = 'alert.raised'") >= 1, "the mismatched refund raised an alert");
  // The dashboard read: the operator view of its own workspace, events included.
  const snap = await snapshot(db, await viewerOf(db, as(cookie)));
  assert.equal(snap.projection.agents.length, 4);
  assert.ok(snap.projection.authorizations.length > 10);
  // A second sign-in does not seed again.
  await passwordSignIn(db, post(), { email: EMAIL, password: PW });
  assert.equal((await db.all("SELECT id FROM agents")).length, 4);
  await db.close();
});

test("every change is refused for the demo account; reads work", async () => {
  const db = await memoryDb();
  const { cookie } = await demo(db);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) assert.equal(await code(requireOperator(as(cookie, method), db)), "read_only_account", method);
  for (const method of ["GET", "HEAD"]) assert.equal(await code(requireOperator(as(cookie, method), db)), "ok", method);
  await db.close();
});

test("the demo sees only its own workspace, and nobody else sees the demo", async () => {
  const db = await memoryDb();
  const { cookie, session } = await demo(db);
  const r = await register(db, post(), { email: "someone@example.com", password: OTHER });
  await verifyEmail(db, post(), { token: /#token=([A-Za-z0-9_-]{43})/.exec(r.outbox[0].text)![1], password: OTHER });
  await setAccess(db, post(), (await db.get<{ id: string }>("SELECT id FROM users WHERE email = ?", "someone@example.com"))!.id, "approve", "admin");
  const other = await passwordSignIn(db, post(), { email: "someone@example.com", password: OTHER });
  const otherWs = (await currentSession(db, as(other.value)))!.workspace;
  const theirs = await registerAgent(db, { name: "Private agent", model: "m", provider: "Anthropic" }, undefined, otherWs);
  const seen = (await snapshot(db, await viewerOf(db, as(cookie)))).projection.agents.map((a) => a.id);
  assert.ok(!seen.includes(theirs.agent.id));
  assert.ok((await snapshot(db, await viewerOf(db, as(other.value)))).projection.agents.every((a) => a.id === theirs.agent.id));
  assert.notEqual(session.workspace, otherWs);
  await db.close();
});

test("a shared demo shows each viewer only their own session, not other people's sign-ins or addresses", async () => {
  const db = await memoryDb();
  const first = await demo(db);
  await passwordSignIn(db, post(), { email: EMAIL, password: PW });
  const o = await sessionOverview(db, first.session);
  assert.deepEqual(o.sessions.map((s) => s.id), [first.session.id]);
  assert.deepEqual(o.recent, []);
  await db.close();
});

test("the demo address takes no mail, and its password can only change through TEND_DEMO_ACCOUNT", async () => {
  const db = await memoryDb();
  const { cookie } = await demo(db);
  assert.equal((await requestReset(db, post(), { email: EMAIL })).outbox.length, 0);
  assert.equal((await register(db, post(), { email: EMAIL, password: "another password 123" })).outbox.length, 0);
  // A new hash is a new password: the old one stops working and its sessions end.
  process.env.TEND_DEMO_ACCOUNT = `${EMAIL} ${await hashPassword("YC-the-next-password")}`;
  assert.equal(await code(passwordSignIn(db, post(), { email: EMAIL, password: PW })), "invalid_credentials");
  assert.equal(await currentSession(db, as(cookie)), undefined);
  const next = await passwordSignIn(db, post(), { email: EMAIL, password: "YC-the-next-password" });
  // Removing the variable turns the demo off: its sessions end and it can no longer sign in.
  delete process.env.TEND_DEMO_ACCOUNT;
  assert.equal(await currentSession(db, as(next.value)), undefined);
  assert.equal(await code(passwordSignIn(db, post(), { email: EMAIL, password: "YC-the-next-password" })), "account_disabled");
  await db.close();
});

test("an existing account with the demo address is somebody's own and is never turned into the demo", async () => {
  const db = await memoryDb();
  delete process.env.TEND_DEMO_ACCOUNT;
  const r = await register(db, post(), { email: EMAIL, password: OTHER });
  await verifyEmail(db, post(), { token: /#token=([A-Za-z0-9_-]{43})/.exec(r.outbox[0].text)![1], password: OTHER });
  process.env.TEND_DEMO_ACCOUNT = `${EMAIL} ${await hashPassword(PW)}`;
  assert.equal(await code(passwordSignIn(db, post(), { email: EMAIL, password: PW })), "invalid_credentials");
  const u = (await db.get<{ read_only: number }>("SELECT read_only FROM users WHERE email = ?", EMAIL))!;
  assert.equal(u.read_only, 0);
  assert.equal((await db.all("SELECT id FROM agents")).length, 0);
  delete process.env.TEND_DEMO_ACCOUNT;
  await db.close();
});

test("the sample activity tops up at most every few minutes and keeps at most two requests waiting", async () => {
  const db = await memoryDb();
  const { session } = await demo(db);
  const count = async () => (await db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM authorizations"))!.n;
  const before = await count();
  await refreshDemo(db, session.workspace, Date.now() + 60_000);
  assert.equal(await count(), before, "too soon: nothing new");
  await refreshDemo(db, session.workspace, Date.now() + 4 * 60_000);
  assert.ok(await count() > before);
  const waiting = (await db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM authorizations WHERE status = 'pending' AND expires_at > ?", Date.now() + 4 * 60_000))!.n;
  assert.ok(waiting >= 1 && waiting <= 2, `waiting: ${waiting}`);
  await db.close();
});

test("Try the live demo: one click gives a read-only demo session, never one into somebody's own account, and is bounded per address", async () => {
  const db = await memoryDb();
  delete process.env.TEND_DEMO_ACCOUNT;
  assert.equal(await code(demoSignIn(db, post())), "demo_off", "no demo configured, no session");
  process.env.TEND_DEMO_ACCOUNT = `${EMAIL} ${await hashPassword(PW)}`;
  const s = await demoSignIn(db, post());
  const session = (await currentSession(db, as(s.value)))!;
  assert.equal(session.readOnly, true);
  assert.equal(await code(requireOperator(as(s.value, "POST"), db)), "read_only_account", "every change is still refused");
  // The same address, past its budget, is refused.
  const same = () => new Request("http://tend.test/api/account/demo", { method: "POST", headers: { host: "tend.test", "x-forwarded-for": "10.9.9.9" } });
  for (let i = 0; i < 20; i++) await demoSignIn(db, same());
  assert.equal(await code(demoSignIn(db, same())), "rate_limited");
  await db.close();
  // Somebody's own account at the demo address is never entered this way.
  const db2 = await memoryDb();
  delete process.env.TEND_DEMO_ACCOUNT;
  const r = await register(db2, post(), { email: EMAIL, password: OTHER });
  await verifyEmail(db2, post(), { token: /#token=([A-Za-z0-9_-]{43})/.exec(r.outbox[0].text)![1], password: OTHER });
  process.env.TEND_DEMO_ACCOUNT = `${EMAIL} ${await hashPassword(PW)}`;
  assert.equal(await code(demoSignIn(db2, post())), "demo_off");
  delete process.env.TEND_DEMO_ACCOUNT;
  await db2.close();
});
