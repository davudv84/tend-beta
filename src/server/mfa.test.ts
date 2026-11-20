// Two-step sign-in (src/server/mfa.ts). Codes in these tests come from an independent RFC 6238 reference written here with node:crypto, not from
// the library under test, and the library is first checked against the RFC's own test vectors.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { verify } from "otplib";
import { passwordSignIn, register, requestReset, resetPassword, setAccess, verifyEmail } from "./accounts.ts";
import { memoryDb, type DB } from "./db.ts";
import { confirmEnrollment, disableMfa, mfaStatus, startEnrollment } from "./mfa.ts";
import { currentSession, sessionCookieName } from "./session.ts";

process.env.TEND_ADMIN_TOKEN = "t".repeat(8) + "0123456789abcdefghijklmnop";
process.env.TEND_DEMO = "0";
process.env.TEND_PUBLIC = "0";
process.env.TEND_TRUSTED_PROXY = "1";
process.env.TEND_MFA_KEY = "k".repeat(16) + "0123456789abcdefghijklmnop";
delete process.env.TEND_ACCOUNTS;

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const unb32 = (s: string) => { let bits = ""; for (const c of s.replace(/=+$/, "")) bits += B32.indexOf(c).toString(2).padStart(5, "0"); return Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2))); };
/** RFC 6238 / RFC 4226 reference: HMAC-SHA1 over the 8-byte big-endian time step, dynamic truncation. */
const ref = (secretB32: string, unixSeconds: number, digits = 6) => {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(unixSeconds / 30)));
  const h = createHmac("sha1", unb32(secretB32)).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 10 ** digits).padStart(digits, "0");
};

let ipn = 0;
const post = () => new Request("http://tend.test/api/account/x", { method: "POST", headers: { host: "tend.test", "x-forwarded-for": `10.3.0.${++ipn % 250}` } });
const get = (v: string) => new Request("http://tend.test/api/v1/state", { headers: { host: "tend.test", cookie: `${sessionCookieName()}=${v}` } });
const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
const PW = "correct horse battery";
async function account(db: DB, email: string) {
  const r = await register(db, post(), { email, password: PW });
  await verifyEmail(db, post(), { token: /#token=([A-Za-z0-9_-]{43})/.exec(r.outbox[0].text)![1], password: PW });
  await setAccess(db, post(), (await db.get<{ id: string }>("SELECT id FROM users WHERE email = ?", email))!.id, "approve", "admin");
  const s = await passwordSignIn(db, post(), { email, password: PW });
  return (await currentSession(db, get(s.value)))!;
}

test("MFA-1 the library agrees with RFC 6238's published test vectors and with the reference here", async () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // "12345678901234567890", the RFC's SHA-1 key
  for (const [t, eight] of [[59, "94287082"], [1111111109, "07081804"], [1234567890, "89005924"], [2000000000, "69279037"]] as const) {
    assert.equal(ref(secret, t, 8), eight, `reference at ${t}`);
    assert.equal((await verify({ secret, token: eight.slice(-6), epoch: t })).valid, true, `library at ${t}`);
  }
});

test("MFA-2 setup → enable: the secret is encrypted at rest, a wrong code does not enable it, the right one does and ends other sessions", async () => {
  const db = await memoryDb();
  const s = await account(db, "mfa2@example.com");
  const other = await passwordSignIn(db, post(), { email: "mfa2@example.com", password: PW });
  const { secret, uri } = await db.tx((q) => startEnrollment(q, s));
  assert.match(uri, /^otpauth:\/\/totp\/.*secret=/);
  const stored = (await db.get<{ secret: string }>("SELECT secret FROM user_mfa WHERE user_id = ?", s.userId))!.secret;
  assert.ok(stored.startsWith("v1.") && !stored.includes(secret), "AES-GCM sealed, the secret is not in the row");
  assert.equal(await code(db.tx((q) => confirmEnrollment(q, s, "000000"))), "mfa_invalid");
  assert.equal((await mfaStatus(db, s.userId!)).enabled, false);
  const r = await db.tx((q) => confirmEnrollment(q, s, ref(secret, Date.now() / 1000)));
  assert.equal(r.recoveryCodes.length, 10);
  assert.equal(await currentSession(db, get(other.value)), undefined, "other sessions end when two-step sign-in is turned on");
  assert.deepEqual(await db.all<{ type: string }>("SELECT type FROM auth_events WHERE user_id = ? AND type LIKE 'mfa.%'", s.userId), [{ type: "mfa.enabled" }]);
});

test("MFA-3 sign-in: password alone asks for the code; a wrong code fails; a code works once (replay refused); recovery codes work once", async () => {
  const db = await memoryDb();
  const s = await account(db, "mfa3@example.com");
  const { secret } = await db.tx((q) => startEnrollment(q, s));
  const now = Date.now();
  const { recoveryCodes } = await db.tx((q) => confirmEnrollment(q, s, ref(secret, now / 1000), now));
  const signIn = (c?: string, at = Date.now()) => passwordSignIn(db, post(), { email: "mfa3@example.com", password: PW, ...(c !== undefined && { code: c }) }, at);
  assert.equal(await code(signIn()), "mfa_required");
  assert.equal(await code(passwordSignIn(db, post(), { email: "mfa3@example.com", password: "wrong password!!", code: "123456" })), "invalid_credentials", "a wrong password never reveals that a code would be needed");
  assert.equal(await code(signIn("000000")), "mfa_invalid");
  const later = now + 60_000; // the next-but-one time step: the code used to enable is spent
  const c = ref(secret, later / 1000);
  assert.equal(await code(signIn(c, later)), "ok");
  assert.equal(await code(signIn(c, later)), "mfa_invalid", "the same code twice: replay refused");
  assert.equal(await code(signIn(ref(secret, now / 1000), later)), "mfa_invalid", "an older code than the last one used is refused");
  assert.equal(await code(signIn(recoveryCodes[0], later)), "ok", "a recovery code works");
  assert.equal(await code(signIn(recoveryCodes[0], later)), "mfa_invalid", "once");
  assert.equal((await mfaStatus(db, s.userId!)).recoveryCodesLeft, 9);
});

test("MFA-4 guessing codes spends the same budget as guessing passwords: it is not reset by the correct password", async () => {
  const db = await memoryDb();
  const s = await account(db, "mfa4@example.com");
  const { secret } = await db.tx((q) => startEnrollment(q, s));
  await db.tx((q) => confirmEnrollment(q, s, ref(secret, Date.now() / 1000)));
  const seen = new Set<string>();
  for (let i = 0; i < 30; i++) seen.add(await code(passwordSignIn(db, post(), { email: "mfa4@example.com", password: PW, code: String(100000 + i) })));
  assert.ok(seen.has("rate_limited"), `wrong codes are limited per account (${[...seen].join(",")})`);
  assert.equal(await code(passwordSignIn(db, post(), { email: "mfa4@example.com", password: PW, code: ref(secret, Date.now() / 1000 + 30) })), "rate_limited", "even the right code waits once the budget is spent");
});

test("MFA-5 turning it off needs a valid code; production refuses setup without TEND_MFA_KEY; a tampered secret never lets anyone in", async () => {
  const db = await memoryDb();
  const s = await account(db, "mfa5@example.com");
  const { secret } = await db.tx((q) => startEnrollment(q, s));
  const now = Date.now();
  await db.tx((q) => confirmEnrollment(q, s, ref(secret, now / 1000), now));
  assert.equal(await code(db.tx((q) => disableMfa(q, s, "000000", now + 30_000))), "mfa_invalid");
  // tamper with the sealed secret (as someone with write access to the table might): sign-in fails, it does not fall back to "no factor"
  const row = (await db.get<{ secret: string }>("SELECT secret FROM user_mfa WHERE user_id = ?", s.userId))!.secret;
  await db.run("UPDATE user_mfa SET secret = ? WHERE user_id = ?", row.slice(0, -4) + (row.endsWith("AAAA") ? "BBBB" : "AAAA"), s.userId);
  assert.notEqual(await code(passwordSignIn(db, post(), { email: "mfa5@example.com", password: PW, code: ref(secret, now / 1000 + 60) }, now + 60_000)), "ok");
  await db.run("UPDATE user_mfa SET secret = ? WHERE user_id = ?", row, s.userId);
  assert.equal(await code(db.tx((q) => disableMfa(q, s, ref(secret, now / 1000 + 90), now + 90_000))), "ok");
  assert.equal(await code(passwordSignIn(db, post(), { email: "mfa5@example.com", password: PW })), "ok", "off again: the password alone");
  const saved = { env: process.env.NODE_ENV, key: process.env.TEND_MFA_KEY };
  try {
    (process.env as Record<string, string>).NODE_ENV = "production"; delete process.env.TEND_MFA_KEY;
    assert.equal(await code(db.tx((q) => startEnrollment(q, s))), "mfa_unavailable");
  } finally { (process.env as Record<string, string | undefined>).NODE_ENV = saved.env; process.env.TEND_MFA_KEY = saved.key; }
});

test("MFA-6 ten wrong codes in a day lock the second factor until a password reset; the platform admin can remove a lost factor, on record", async () => {
  const db = await memoryDb();
  const s = await account(db, "mfa6@example.com");
  const { secret } = await db.tx((q) => startEnrollment(q, s));
  const now = Date.now();
  await db.tx((q) => confirmEnrollment(q, s, ref(secret, now / 1000), now));
  for (let i = 0; i < 10; i++) assert.equal(await code(passwordSignIn(db, post(), { email: "mfa6@example.com", password: PW, code: String(200000 + i) }, now + 30_000)), "mfa_invalid");
  assert.equal(await code(passwordSignIn(db, post(), { email: "mfa6@example.com", password: PW, code: ref(secret, now / 1000 + 60) }, now + 60_000)), "mfa_locked", "the right code is refused once locked");
  assert.equal(await code(passwordSignIn(db, post(), { email: "mfa6@example.com", password: "wrong password!!", code: "1" }, now + 60_000)), "invalid_credentials", "a wrong password still says nothing about the second factor");
  const reset = await requestReset(db, post(), { email: "mfa6@example.com" }, now + 61_000);
  await resetPassword(db, { token: /#token=([A-Za-z0-9_-]{43})/.exec(reset.outbox[0].text)![1], password: PW }, now + 62_000);
  assert.equal(await code(passwordSignIn(db, post(), { email: "mfa6@example.com", password: PW, code: ref(secret, now / 1000 + 90) }, now + 90_000)), "ok", "after the reset: unlocked, the second factor still required and working");
  const r = await setAccess(db, post(), s.userId!, "reset_mfa", "admin-session");
  assert.equal((await mfaStatus(db, s.userId!)).enabled, false);
  assert.match(r.outbox[0].text, /turned off .* by the TEND admin/);
  assert.equal((await db.get<{ reason: string }>("SELECT reason FROM auth_events WHERE user_id = ? AND type = 'mfa.disabled'", s.userId))!.reason, "admin_reset");
});

test("MFA-7 the sealed secret's GCM tag must be full length: the real tag cut to 4 bytes is refused (Node would accept it without authTagLength)", async () => {
  const db = await memoryDb();
  const s = await account(db, "mfa7@example.com");
  const { secret } = await db.tx((q) => startEnrollment(q, s));
  const now = Date.now();
  await db.tx((q) => confirmEnrollment(q, s, ref(secret, now / 1000), now));
  const row = (await db.get<{ secret: string }>("SELECT secret FROM user_mfa WHERE user_id = ?", s.userId))!.secret;
  const [v, iv, tag, ct] = row.split(".");
  const short = Buffer.from(tag, "base64url").subarray(0, 4).toString("base64url");
  await db.run("UPDATE user_mfa SET secret = ? WHERE user_id = ?", [v, iv, short, ct].join("."), s.userId);
  assert.notEqual(await code(passwordSignIn(db, post(), { email: "mfa7@example.com", password: PW, code: ref(secret, now / 1000 + 60) }, now + 60_000)), "ok", "a truncated tag never verifies");
});
