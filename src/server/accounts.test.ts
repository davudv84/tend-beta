// E-mail accounts: what a caller can learn, the order of the steps, one-time links, rate limits, and how sessions follow the account's state.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPassword, hashPassword, LIMITS, passwordSignIn, register, requestReset, resendVerification, resetPassword, setAccess, verifyEmail, type Outbox } from "./accounts.ts";
import { memoryDb, type DB } from "./db.ts";
import { currentSession, sessionCookieName } from "./session.ts";
import { awayFromMinuteBoundary } from "./test-support.ts";

process.env.TEND_ADMIN_TOKEN = "t".repeat(8) + "0123456789abcdefghijklmnop";
process.env.TEND_DEMO = "0";
process.env.TEND_TRUSTED_PROXY = "1"; // so each test caller can have its own address
delete process.env.TEND_ACCOUNTS;
delete process.env.TEND_ADMIN_EMAIL;

let ipn = 0;
const req = (ip = `10.0.0.${++ipn % 250}`) => new Request("http://tend.test/api/account/x", { method: "POST", headers: { host: "tend.test", "x-forwarded-for": ip } });
const withCookie = (value: string) => new Request("http://tend.test/api/v1/x", { headers: { host: "tend.test", cookie: `${sessionCookieName()}=${value}` } });
const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
const tokenIn = (outbox: Outbox) => /#token=([A-Za-z0-9_-]{43})/.exec(outbox.at(-1)?.text ?? "")?.[1];
const PW = "correct horse battery";

/** A verified, approved account, ready to sign in. */
async function account(db: DB, email: string) {
  const r = await register(db, req(), { email, password: PW });
  await verifyEmail(db, req(), { token: tokenIn(r.outbox), password: PW });
  const id = (await db.get<{ id: string }>("SELECT id FROM users WHERE email = ?", email))!.id;
  await setAccess(db, req(), id, "approve", "admin");
  return id;
}

test("passwords are stored as salted scrypt hashes that never contain the password", async () => {
  const a = await hashPassword(PW), b = await hashPassword(PW);
  assert.match(a, /^scrypt\$15\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b, "a fresh salt each time");
  assert.ok(!a.includes(PW));
  assert.equal(await checkPassword(PW, a), true);
  assert.equal(await checkPassword(`${PW}!`, a), false);
  assert.equal(await checkPassword(PW, "md5$abc"), false);
});

test("sign-up answers the same for a new and an existing address; only the mail differs, and weak input is refused", async () => {
  const db = await memoryDb();
  const first = await register(db, req(), { email: "Ada@Example.com", password: PW });
  const again = await register(db, req(), { email: "ada@example.com", password: "another long password" });
  assert.deepEqual(first.result, again.result);
  assert.match(first.outbox[0].text, /\/account\/verify#token=/, "the new address gets a confirmation link");
  assert.equal(first.outbox[0].to, "ada@example.com");
  assert.match(again.outbox[0].text, /\/account\/verify#token=/, "an unconfirmed existing address gets a fresh link, not a second account");
  assert.equal((await db.all("SELECT 1 FROM users")).length, 1);
  await verifyEmail(db, req(), { token: tokenIn(again.outbox), password: PW });
  const third = await register(db, req(), { email: "ada@example.com", password: PW });
  assert.deepEqual(third.result, first.result);
  assert.match(third.outbox[0].text, /already has one/, "a confirmed address is told it has an account, nothing more");
  assert.equal(await code(register(db, req(), { email: "not-an-address", password: PW })), "invalid_email");
  assert.equal(await code(register(db, req(), { email: "b@example.com", password: "short" })), "weak_password");
  assert.equal(await code(register(db, req(), { email: "bobby@example.com", password: "bobby-is-my-password" })), "weak_password");
  await db.close();
});

test("the order is enforced: confirm, then approval, then a session; wrong address and wrong password are one error", async () => {
  const db = await memoryDb();
  const r = await register(db, req(), { email: "eve@example.com", password: PW });
  assert.equal(await code(passwordSignIn(db, req(), { email: "eve@example.com", password: PW })), "email_unverified");
  assert.equal(await code(passwordSignIn(db, req(), { email: "eve@example.com", password: "wrong password!!" })), "invalid_credentials");
  assert.equal(await code(passwordSignIn(db, req(), { email: "nobody@example.com", password: PW })), "invalid_credentials");
  const token = tokenIn(r.outbox);
  process.env.TEND_ADMIN_EMAIL = "admin@example.com";
  const v = await verifyEmail(db, req(), { token, password: PW });
  delete process.env.TEND_ADMIN_EMAIL;
  assert.deepEqual(v.result, { ok: true, approved: false });
  assert.match(v.outbox[0].text, /eve@example.com confirmed/, "the admin is told someone waits");
  assert.equal(await code(verifyEmail(db, req(), { token, password: PW })), "invalid_link", "a link works once");
  assert.equal(await code(verifyEmail(db, req(), { token: "x".repeat(43), password: PW })), "invalid_link");
  assert.equal(await code(passwordSignIn(db, req(), { email: "eve@example.com", password: PW })), "pending_approval");
  const id = (await db.get<{ id: string }>("SELECT id FROM users"))!.id;
  const approved = await setAccess(db, req(), id, "approve", "admin");
  assert.match(approved.outbox[0].text, /approved/);
  const s = await passwordSignIn(db, req(), { email: " EVE@example.com ", password: PW });
  const session = await currentSession(db, withCookie(s.value));
  assert.equal(session?.userId, id);
  assert.equal(session?.admin, false);
  assert.match(session!.workspace, /^ws_/);
  await db.close();
});

test("an unconfirmed address cannot be approved, and an expired link does not work", async () => {
  const db = await memoryDb();
  const now = Date.now();
  const r = await register(db, req(), { email: "late@example.com", password: PW }, now);
  const id = (await db.get<{ id: string }>("SELECT id FROM users"))!.id;
  assert.equal(await code(setAccess(db, req(), id, "approve", "admin")), "email_unverified");
  assert.equal(await code(verifyEmail(db, req(), { token: tokenIn(r.outbox), password: PW }, now + 25 * 3_600_000)), "invalid_link");
  await db.close();
});

test("disabling ends every session at once; a session also ends when the password changes", async () => {
  const db = await memoryDb();
  const id = await account(db, "dan@example.com");
  const s = await passwordSignIn(db, req(), { email: "dan@example.com", password: PW });
  assert.ok(await currentSession(db, withCookie(s.value)));
  await setAccess(db, req(), id, "disable", "admin");
  assert.equal(await currentSession(db, withCookie(s.value)), undefined);
  assert.equal(await code(passwordSignIn(db, req(), { email: "dan@example.com", password: PW })), "account_disabled");
  await setAccess(db, req(), id, "enable", "admin");
  assert.equal(await currentSession(db, withCookie(s.value)), undefined, "an ended session stays ended");
  const again = await passwordSignIn(db, req(), { email: "dan@example.com", password: PW });
  assert.ok(await currentSession(db, withCookie(again.value)));
  await db.close();
});

test("forgot password answers the same for every address; a reset works once, ends every session and replaces the password", async () => {
  const db = await memoryDb();
  await account(db, "rae@example.com");
  const s = await passwordSignIn(db, req(), { email: "rae@example.com", password: PW });
  const unknown = await requestReset(db, req(), { email: "who@example.com" });
  const known = await requestReset(db, req(), { email: "rae@example.com" });
  assert.deepEqual(unknown.result, known.result);
  assert.equal(unknown.outbox.length, 0);
  const token = tokenIn(known.outbox);
  assert.equal(await code(resetPassword(db, { token, password: "short" })), "weak_password");
  assert.deepEqual(await resetPassword(db, { token, password: "a brand new passphrase" }), { ok: true }, "a refused password did not use up the link");
  assert.equal(await code(resetPassword(db, { token, password: "yet another passphrase" })), "invalid_link");
  assert.equal(await currentSession(db, withCookie(s.value)), undefined, "the old session ended");
  assert.equal(await code(passwordSignIn(db, req(), { email: "rae@example.com", password: PW })), "invalid_credentials");
  assert.equal(await code(passwordSignIn(db, req(), { email: "rae@example.com", password: "a brand new passphrase" })), "ok");
  const r2 = await resendVerification(db, req(), { email: "rae@example.com" });
  assert.equal(r2.outbox.length, 0, "a confirmed address gets no new confirmation link");
  await db.close();
});

test("guessing is bounded per caller address and per account, and sign-ups and mails per hour", async () => {
  const db = await memoryDb();
  await account(db, "sam@example.com");
  await awayFromMinuteBoundary(); // the per-address budget is per calendar minute
  const one = "10.9.9.9";
  for (let i = 0; i < LIMITS.signInFailuresPerMinute; i++) assert.equal(await code(passwordSignIn(db, req(one), { email: "sam@example.com", password: `wrong ${i} password` })), "invalid_credentials");
  assert.equal(await code(passwordSignIn(db, req(one), { email: "sam@example.com", password: PW })), "rate_limited", "even the right password, from that address");
  let refused = false;
  for (let i = 0; i < LIMITS.failuresPerAccountPerHour + 2 && !refused; i++) refused = (await code(passwordSignIn(db, req(), { email: "sam@example.com", password: `still wrong ${i}` }))) === "rate_limited";
  assert.ok(refused, "many addresses guessing one account are refused too");
  const ip = "10.8.8.8";
  for (let i = 0; i < LIMITS.registrationsPerHour; i++) await register(db, req(ip), { email: `n${i}@example.com`, password: PW });
  assert.equal(await code(register(db, req(ip), { email: "n9@example.com", password: PW })), "rate_limited");
  let mails = 0;
  for (let i = 0; i < 6; i++) mails += (await requestReset(db, req(), { email: "sam@example.com" })).outbox.length;
  assert.equal(mails, LIMITS.mailsPerAccountPerHour, "no more reset mails than the hourly budget, whatever is asked");
  await db.close();
});

test("with accounts switched off, every account endpoint says so and nothing is created", async () => {
  const db = await memoryDb();
  process.env.TEND_ACCOUNTS = "0";
  try {
    assert.equal(await code(register(db, req(), { email: "x@example.com", password: PW })), "accounts_disabled");
    assert.equal(await code(passwordSignIn(db, req(), { email: "x@example.com", password: PW })), "accounts_disabled");
    assert.equal((await db.all("SELECT 1 FROM users")).length, 0);
  } finally {
    delete process.env.TEND_ACCOUNTS;
    await db.close();
  }
});

// From the security review of 2026-10-31. Before: whoever signed up first with an address chose the password, and the owner's own
// confirmation click activated it, handing the owner's account (and everything they later connected) to the first sign-up.
test("signing up first with someone else's address gets you nothing: the confirmation needs the password the owner chose", async () => {
  process.env.TEND_ADMIN = "0";
  try {
    const db = await memoryDb();
    const victim = "victim@example.com", attackerPw = "attacker chose this one", ownerPw = "the owner's own passphrase";
    await register(db, req(), { email: victim, password: attackerPw }); // the attacker never sees this mail
    const owner = await register(db, req(), { email: victim, password: ownerPw });
    const link = tokenIn(owner.outbox)!;
    assert.equal(await code(verifyEmail(db, req(), { token: link, password: ownerPw })), "password_mismatch", "the stored password is not the owner's: refused");
    assert.equal(await code(verifyEmail(db, req(), { token: link })), "password_mismatch", "and no password is no confirmation");
    assert.equal(await code(passwordSignIn(db, req(), { email: victim, password: attackerPw })), "email_unverified", "the attacker still has no session");
    // The owner takes the way the error offers: a password reset, which proves the mailbox and sets their password.
    const forgot = await requestReset(db, req(), { email: victim });
    await resetPassword(db, { token: tokenIn(forgot.outbox), password: ownerPw });
    assert.equal(await code(passwordSignIn(db, req(), { email: victim, password: attackerPw })), "invalid_credentials", "the attacker's password is gone");
    assert.equal(await code(passwordSignIn(db, req(), { email: victim, password: ownerPw })), "ok", "the owner is in, confirmed and ready");
    // The confirmation link, still unspent, now works only with the owner's password.
    assert.equal(await code(verifyEmail(db, req(), { token: link, password: attackerPw })), "password_mismatch");
  } finally {
    delete process.env.TEND_ADMIN;
  }
});

test("a password reset ends a lockout someone else caused, and a reset without a live link costs the server no password hashing", async () => {
  const db = await memoryDb();
  const email = "owner@example.com";
  const r = await register(db, req(), { email, password: PW });
  await verifyEmail(db, req(), { token: tokenIn(r.outbox), password: PW });
  for (let i = 0; i <= LIMITS.failuresPerAccountPerHour; i++) await code(passwordSignIn(db, req(), { email, password: "someone guessing wrong" }));
  assert.equal(await code(passwordSignIn(db, req(), { email, password: PW })), "rate_limited", "locked out by someone else's guesses");
  const forgot = await requestReset(db, req(), { email });
  await resetPassword(db, { token: tokenIn(forgot.outbox), password: "a brand new passphrase" });
  assert.notEqual(await code(passwordSignIn(db, req(), { email, password: "a brand new passphrase" })), "rate_limited", "the reset ends the lockout");
  const start = performance.now();
  for (let i = 0; i < 20; i++) assert.equal(await code(resetPassword(db, { token: "x".repeat(43), password: "a long enough password" })), "invalid_link");
  assert.ok(performance.now() - start < 1_000, "twenty bad links answered without twenty scrypt hashes");
});
