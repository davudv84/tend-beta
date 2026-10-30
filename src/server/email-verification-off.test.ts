// E-mail verification turned off (TEND_EMAIL_VERIFICATION=0): no confirmation mail, sign-in at once, and nothing else gets weaker. The address
// stays recorded as not confirmed, so turning verification back on asks those accounts to confirm it.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { passwordSignIn, register, type Outbox } from "./accounts.ts";
import { memoryDb, type DB } from "./db.ts";
import { currentSession, sessionCookieName, viewerOf } from "./session.ts";

process.env.TEND_DEMO = "0";
process.env.TEND_TRUSTED_PROXY = "1";
afterEach(() => { for (const k of ["TEND_ADMIN", "TEND_EMAIL_VERIFICATION", "TEND_ADMIN_EMAIL"]) delete process.env[k]; });

let ipn = 0;
const req = () => new Request("http://tend.test/api/account/x", { method: "POST", headers: { host: "tend.test", "x-forwarded-for": `10.2.0.${++ipn % 250}` } });
const withCookie = (value: string) => new Request("http://tend.test/api/v1/x", { headers: { host: "tend.test", cookie: `${sessionCookieName()}=${value}` } });
const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
const PW = "correct horse battery";
const user = (db: DB, email: string) => db.get<{ id: string; email_verified_at: number | null; approved_by: string | null }>("SELECT * FROM users WHERE email = ?", email);
const subjects = (o: Outbox) => o.map((m) => m.subject);

test("verification off: sign-up sends no confirmation mail, sign-in works at once, and the address stays recorded as unconfirmed", async () => {
  process.env.TEND_ADMIN = "0";
  process.env.TEND_EMAIL_VERIFICATION = "0";
  const db = await memoryDb();
  const r = await register(db, req(), { email: "ana@example.com", password: PW });
  assert.deepEqual(r.outbox, [], "no mail at all for a new account");
  assert.equal((r.result as { verification?: boolean }).verification, false, "the client is told to sign in next");
  assert.equal((await user(db, "ana@example.com"))!.email_verified_at, null, "not claimed as confirmed");
  assert.equal(await db.get("SELECT 1 FROM user_tokens"), undefined, "no confirmation link exists");
  const s = await passwordSignIn(db, req(), { email: "ana@example.com", password: PW });
  const session = await currentSession(db, withCookie(s.value));
  assert.equal(session?.email, "ana@example.com");
  assert.equal((await user(db, "ana@example.com"))!.approved_by, "automatic");
  assert.equal((await viewerOf(db, withCookie(s.value))).emailVerification, false);
  await db.close();
});

test("verification off: the same answer for a taken address, wrong passwords still fail, and the owner is told by mail", async () => {
  process.env.TEND_ADMIN = "0";
  process.env.TEND_EMAIL_VERIFICATION = "0";
  const db = await memoryDb();
  const first = await register(db, req(), { email: "ana@example.com", password: PW });
  const again = await register(db, req(), { email: "ana@example.com", password: "another long password" });
  assert.deepEqual(again.result, first.result, "sign-up does not say whether the address is taken");
  assert.deepEqual(subjects(again.outbox), ["Your TEND account"], "the address's owner hears that someone tried");
  assert.equal(await code(passwordSignIn(db, req(), { email: "ana@example.com", password: "another long password" })), "invalid_credentials", "the second sign-up did not change the password");
  assert.equal(await code(passwordSignIn(db, req(), { email: "nobody@example.com", password: PW })), "invalid_credentials");
  await db.close();
});

test("turning verification back on: unconfirmed accounts must confirm again, and their sessions end on the next request", async () => {
  process.env.TEND_ADMIN = "0";
  process.env.TEND_EMAIL_VERIFICATION = "0";
  const db = await memoryDb();
  await register(db, req(), { email: "ana@example.com", password: PW });
  const s = await passwordSignIn(db, req(), { email: "ana@example.com", password: PW });
  delete process.env.TEND_EMAIL_VERIFICATION;
  assert.equal(await currentSession(db, withCookie(s.value)), undefined, "the session is refused");
  assert.equal(await code(passwordSignIn(db, req(), { email: "ana@example.com", password: PW })), "email_unverified");
  const r = await register(db, req(), { email: "ana@example.com", password: PW });
  assert.deepEqual(subjects(r.outbox), ["Confirm your e-mail address for TEND"], "and can ask for a confirmation link again");
  await db.close();
});

test("verification off with the admin on: the account still waits for approval, and the admin hears about it at sign-up", async () => {
  process.env.TEND_EMAIL_VERIFICATION = "0";
  process.env.TEND_ADMIN_EMAIL = "admin@example.com";
  const db = await memoryDb();
  const r = await register(db, req(), { email: "ben@example.com", password: PW });
  assert.deepEqual(r.outbox.map((m) => m.to), ["admin@example.com"]);
  assert.equal(await code(passwordSignIn(db, req(), { email: "ben@example.com", password: PW })), "pending_approval", "approval is not skipped");
  await db.close();
});
