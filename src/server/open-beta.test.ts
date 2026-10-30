// The admin turned off (TEND_ADMIN=0): a confirmed address is enough, the admin cannot sign in or be reached, and nothing else gets weaker.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { passwordSignIn, register, verifyEmail, type Outbox } from "./accounts.ts";
import { config } from "./config.ts";
import { memoryDb, type DB } from "./db.ts";
import { requireAdmin, requireOperator } from "./http.ts";
import { agentInWorkspace, registerAgent } from "./repo.ts";
import { createSession, currentSession, sessionCookieName, viewerOf } from "./session.ts";
import { signIn } from "./signin.ts";

const TOKEN = "t".repeat(8) + "0123456789abcdefghijklmnop";
process.env.TEND_ADMIN_TOKEN = TOKEN;
process.env.TEND_DEMO = "0";
process.env.TEND_TRUSTED_PROXY = "1";
delete process.env.TEND_ACCOUNTS;
delete process.env.TEND_ADMIN;
afterEach(() => { delete process.env.TEND_ADMIN; delete process.env.TEND_ADMIN_EMAIL; delete process.env.TEND_PUBLIC; });

let ipn = 0;
const req = (ip = `10.1.0.${++ipn % 250}`) => new Request("http://tend.test/api/account/x", { method: "POST", headers: { host: "tend.test", "x-forwarded-for": ip } });
const withCookie = (value: string) => new Request("http://tend.test/api/v1/x", { headers: { host: "tend.test", cookie: `${sessionCookieName()}=${value}` } });
const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
const tokenIn = (outbox: Outbox) => /#token=([A-Za-z0-9_-]{43})/.exec(outbox.at(-1)?.text ?? "")?.[1];
const PW = "correct horse battery";
const user = (db: DB, email: string) => db.get<{ id: string; workspace_id: string; approved_at: number | null; approved_by: string | null }>("SELECT * FROM users WHERE email = ?", email);

test("without the admin: sign up, confirm, sign in at once; nothing before the address is confirmed", async () => {
  process.env.TEND_ADMIN = "0";
  process.env.TEND_ADMIN_EMAIL = "admin@example.com";
  const db = await memoryDb();
  const r = await register(db, req(), { email: "ana@example.com", password: PW });
  assert.equal(await code(passwordSignIn(db, req(), { email: "ana@example.com", password: PW })), "email_unverified", "confirming the address stays mandatory");
  const v = await verifyEmail(db, req(), { token: tokenIn(r.outbox) });
  assert.deepEqual(v.result, { ok: true, approved: true });
  assert.equal(v.outbox.length, 0, "no 'waiting for approval' mail to an admin who is turned off");
  const u = (await user(db, "ana@example.com"))!;
  assert.ok(u.approved_at !== null);
  assert.equal(u.approved_by, "automatic", "the approval is on record as automatic");
  assert.ok(await db.get("SELECT 1 FROM auth_events WHERE type = 'account.approved' AND user_id = ? AND reason = 'automatic'", u.id));
  const s = await passwordSignIn(db, req(), { email: "ana@example.com", password: PW });
  const session = await currentSession(db, withCookie(s.value));
  assert.equal(session?.userId, u.id);
  assert.equal(session?.workspace, u.workspace_id);
  assert.equal(session?.admin, false);
  assert.equal(await code(passwordSignIn(db, req(), { email: "ana@example.com", password: "wrong password!!" })), "invalid_credentials");
  await db.close();
});

test("an account confirmed while approval was required, still waiting, can sign in once the admin is off; an unconfirmed one still cannot", async () => {
  const db = await memoryDb();
  const waiting = await register(db, req(), { email: "wes@example.com", password: PW });
  await verifyEmail(db, req(), { token: tokenIn(waiting.outbox) });
  await register(db, req(), { email: "una@example.com", password: PW });
  assert.equal(await code(passwordSignIn(db, req(), { email: "wes@example.com", password: PW })), "pending_approval", "with the admin on, approval is still required");
  process.env.TEND_ADMIN = "0";
  assert.equal(await code(passwordSignIn(db, req(), { email: "wes@example.com", password: "wrong password!!" })), "invalid_credentials", "a wrong password approves nothing");
  assert.equal((await user(db, "wes@example.com"))!.approved_at, null);
  assert.equal(await code(passwordSignIn(db, req(), { email: "wes@example.com", password: PW })), "ok");
  assert.equal((await user(db, "wes@example.com"))!.approved_by, "automatic");
  assert.equal(await code(passwordSignIn(db, req(), { email: "una@example.com", password: PW })), "email_unverified");
  assert.equal((await user(db, "una@example.com"))!.approved_at, null);
  await db.close();
});

test("a disabled account stays disabled without the admin", async () => {
  process.env.TEND_ADMIN = "0";
  const db = await memoryDb();
  const r = await register(db, req(), { email: "dee@example.com", password: PW });
  await verifyEmail(db, req(), { token: tokenIn(r.outbox) });
  const s = await passwordSignIn(db, req(), { email: "dee@example.com", password: PW });
  await db.run("UPDATE users SET disabled_at = ? WHERE email = ?", Date.now(), "dee@example.com");
  assert.equal(await currentSession(db, withCookie(s.value)), undefined);
  assert.equal(await code(passwordSignIn(db, req(), { email: "dee@example.com", password: PW })), "account_disabled");
  await db.close();
});

test("without the admin: the token cannot sign in, an earlier admin session ends, admin routes do not exist, and the dashboard is never public", async () => {
  const db = await memoryDb();
  const before = await createSession(db, {}); // an admin session from before the switch
  assert.equal((await currentSession(db, withCookie(before.value)))?.admin, true);
  process.env.TEND_ADMIN = "0";
  process.env.TEND_PUBLIC = "1";
  assert.equal(config.public, false, "TEND_PUBLIC=1 cannot open the dashboard while the admin is off");
  assert.equal(await code(signIn(db, req(), { token: TOKEN })), "not_found", "the right admin token gets nothing");
  assert.equal(await currentSession(db, withCookie(before.value)), undefined, "the earlier admin session is refused");
  const adminReq = new Request("http://tend.test/api/admin/users", { headers: { host: "tend.test", cookie: `${sessionCookieName()}=${before.value}` } });
  assert.equal(await code(requireAdmin(adminReq, db)), "not_found");
  assert.equal(await code(requireAdmin(new Request("http://tend.test/api/admin/users"), db)), "not_found");
  assert.equal(await code(requireOperator(new Request("http://tend.test/api/v1/state"), db)), "operator_required", "signed out, the dashboard is still refused");
  const v = await viewerOf(db, new Request("http://tend.test/"));
  assert.deepEqual([v.role, v.canAct, v.public, v.operatorAvailable, v.admin, v.approval], ["visitor", false, false, false, false, false]);
  delete process.env.TEND_ADMIN;
  assert.equal(await currentSession(db, withCookie(before.value)), undefined, "and stays ended when the admin comes back");
  await db.close();
});

test("without the admin, two accounts still see only their own workspace", async () => {
  process.env.TEND_ADMIN = "0";
  const db = await memoryDb();
  const ws: string[] = [];
  for (const email of ["amy@example.com", "ben@example.com"]) {
    const r = await register(db, req(), { email, password: PW });
    await verifyEmail(db, req(), { token: tokenIn(r.outbox) });
    const s = await passwordSignIn(db, req(), { email, password: PW });
    ws.push((await currentSession(db, withCookie(s.value)))!.workspace);
  }
  assert.notEqual(ws[0], ws[1]);
  assert.ok(!ws.includes("default"), "neither account lands in the admin's workspace");
  const { agent } = await registerAgent(db, { name: "Mailer", model: "m", provider: "Custom" }, "amy", ws[0]);
  await agentInWorkspace(db, ws[0], agent.id);
  assert.equal(await code(agentInWorkspace(db, ws[1], agent.id)), "agent_not_found");
  await db.close();
});
