// The admin's optional second factor (TEND_ADMIN_TOTP_SECRET). Off unless configured, so existing servers sign in exactly as before; on, the
// token alone is refused, a wrong or reused code is refused with the same answer as a wrong token, and a broken secret disables admin sign-in.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { memoryDb } from "./db.ts";
import { viewerOf } from "./session.ts";
import { signIn } from "./signin.ts";
import { decodeSecret, hotp, STEP_MS } from "./totp.ts";

const TOKEN = `admin_${randomBytes(24).toString("hex")}`;
const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // base32 of the RFC 6238 test secret; never a real one
process.env.TEND_ADMIN_TOKEN = TOKEN;
process.env.TEND_DEMO = "0";
process.env.TEND_TRUSTED_PROXY = "1";
delete process.env.VERCEL;

let ip = 0;
const req = () => new Request("http://tend.test/api/operator/session", { method: "POST", headers: { host: "tend.test", "x-forwarded-for": `10.9.0.${++ip % 250}` } });
const outcome = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return `${(e as { status?: number }).status} ${(e as { code?: string }).code}`; } };
const codeAt = (now: number, offset = 0) => hotp(decodeSecret(SECRET)!, Math.floor(now / STEP_MS) + offset);

test("without TEND_ADMIN_TOTP_SECRET nothing changes: the token alone signs in, and the sign-in form asks for no code", async () => {
  delete process.env.TEND_ADMIN_TOTP_SECRET;
  const db = await memoryDb();
  assert.equal(await outcome(signIn(db, req(), { token: TOKEN })), "ok");
  assert.equal((await viewerOf(db, req())).adminCode, false);
  await db.close();
});

test("with it: the token alone, a wrong code, or a wrong token with the right code are all refused with the same answer", async () => {
  process.env.TEND_ADMIN_TOTP_SECRET = SECRET;
  try {
    const db = await memoryDb();
    const now = 1_700_000_000_000;
    assert.equal((await viewerOf(db, req())).adminCode, true, "the form knows to ask for a code");
    const wrongCode = String((Number(codeAt(now)) + 1) % 1e6).padStart(6, "0");
    const answers = [
      await outcome(signIn(db, req(), { token: TOKEN }, now)),
      await outcome(signIn(db, req(), { token: TOKEN, code: wrongCode }, now)),
      await outcome(signIn(db, req(), { token: TOKEN, code: codeAt(now, 5) }, now)),
      await outcome(signIn(db, req(), { token: `admin_${"x".repeat(48)}`, code: codeAt(now) }, now)),
    ];
    assert.deepEqual(answers, Array(4).fill("401 invalid_token"), "a wrong code never tells an attacker the token was right");
    await db.close();
  } finally {
    delete process.env.TEND_ADMIN_TOTP_SECRET;
  }
});

test("with it: the token and a current code sign in, once; the same code again is refused, the next one works", async () => {
  process.env.TEND_ADMIN_TOTP_SECRET = SECRET;
  try {
    const db = await memoryDb();
    const now = 1_700_000_000_000;
    assert.equal(await outcome(signIn(db, req(), { token: TOKEN, code: codeAt(now) }, now)), "ok");
    assert.equal(await outcome(signIn(db, req(), { token: TOKEN, code: codeAt(now) }, now + 5_000)), "401 invalid_token", "a code seen once is spent");
    assert.equal(await outcome(signIn(db, req(), { token: TOKEN, code: codeAt(now + STEP_MS) }, now + STEP_MS)), "ok", "the next code works");
    assert.equal(await outcome(signIn(db, req(), { token: TOKEN, code: codeAt(now, -1) }, now)), "ok", "the previous step's code, unused, is still accepted (clock drift)");
    const log = await db.all<{ row: string }>("SELECT row_to_json(e)::text AS row FROM auth_events e");
    assert.ok(log.some((r) => r.row.includes("code_reused")), "the reuse is in the authentication log");
    await db.close();
  } finally {
    delete process.env.TEND_ADMIN_TOTP_SECRET;
  }
});

test("a configured secret that is not usable disables admin sign-in instead of being skipped", async () => {
  for (const bad of ["too-short", "JBSWY3DPEHPK3PXP", "not base32 at all!!"]) {
    process.env.TEND_ADMIN_TOTP_SECRET = bad;
    const db = await memoryDb();
    assert.equal(await outcome(signIn(db, req(), { token: TOKEN, code: "123456" })), "403 operator_disabled", bad);
    await db.close();
  }
  delete process.env.TEND_ADMIN_TOTP_SECRET;
});

test("turning the second factor on, or changing its secret, ends admin sessions issued before; without it, sessions are kept as before", async () => {
  const { createSession, currentSession, sessionCookieName } = await import("./session.ts");
  const as = (value: string) => new Request("http://tend.test/api/v1/state", { headers: { host: "tend.test", cookie: `${sessionCookieName()}=${value}` } });
  delete process.env.TEND_ADMIN_TOTP_SECRET;
  const db = await memoryDb();
  const before = await createSession(db);
  assert.ok(await currentSession(db, as(before.value)), "a session issued with the token alone");
  process.env.TEND_ADMIN_TOTP_SECRET = SECRET;
  try {
    assert.equal(await currentSession(db, as(before.value)), undefined, "ends once the second factor is required");
    const withCode = await createSession(db);
    assert.ok(await currentSession(db, as(withCode.value)));
    process.env.TEND_ADMIN_TOTP_SECRET = "MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43U"; // a different (made-up) secret
    assert.equal(await currentSession(db, as(withCode.value)), undefined, "ends when the secret changes");
  } finally {
    delete process.env.TEND_ADMIN_TOTP_SECRET;
  }
  assert.equal(await currentSession(db, as(before.value)), undefined, "and an ended session stays ended");
  await db.close();
});
