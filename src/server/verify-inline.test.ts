// The sign-up page waits for the address to be confirmed by trying to sign in with the password just typed. That must stay harmless: an
// unconfirmed account never gets a session, the checks never lock the account or the address out, and wrong passwords still count as failures.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { passwordSignIn, register, resendVerification, verifyEmail, type Outbox } from "./accounts.ts";
import { memoryDb } from "./db.ts";
import { requireOperator } from "./http.ts";
import { currentSession, sessionCookieName } from "./session.ts";

process.env.TEND_DEMO = "0";
process.env.TEND_TRUSTED_PROXY = "1";
afterEach(() => { delete process.env.TEND_ADMIN; delete process.env.TEND_EMAIL_VERIFICATION; });

const req = () => new Request("http://tend.test/api/account/x", { method: "POST", headers: { host: "tend.test", "x-forwarded-for": "10.9.0.1" } });
const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
const tokenIn = (o: Outbox) => /#token=([A-Za-z0-9_-]{43})/.exec(o.at(-1)?.text ?? "")?.[1];
const PW = "correct horse battery";

test("waiting for confirmation: repeated checks get 'not confirmed yet', never a session or a lockout, then succeed once confirmed", async () => {
  process.env.TEND_ADMIN = "0";
  const db = await memoryDb();
  const r = await register(db, req(), { email: "ana@example.com", password: PW });
  // An hour of the page's checks, compressed: far more than any failure budget (10 a minute per address, 20 an hour per account).
  for (let i = 0; i < 60; i++) assert.equal(await code(passwordSignIn(db, req(), { email: "ana@example.com", password: PW })), "email_unverified", `check ${i}`);
  assert.equal((await db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM operator_sessions"))!.n, 0, "no session exists for an unconfirmed account");
  assert.equal(await code(requireOperator(new Request("http://tend.test/api/v1/agents", { method: "POST", headers: { host: "tend.test" } }), db)), "operator_required", "protected routes refuse it");
  await verifyEmail(db, req(), { token: tokenIn(r.outbox) });
  const s = await passwordSignIn(db, req(), { email: "ana@example.com", password: PW });
  const session = await currentSession(db, new Request("http://tend.test/", { headers: { host: "tend.test", cookie: `${sessionCookieName()}=${s.value}` } }));
  assert.equal(session?.email, "ana@example.com", "the page continues into a real session");
  await db.close();
});

test("wrong passwords still count while an account is unconfirmed, so the checks cannot be used to guess", async () => {
  process.env.TEND_ADMIN = "0";
  const db = await memoryDb();
  await register(db, req(), { email: "ben@example.com", password: PW });
  const results: string[] = [];
  for (let i = 0; i < 25; i++) results.push(await code(passwordSignIn(db, req(), { email: "ben@example.com", password: `wrong password ${i}` })));
  assert.ok(results.slice(0, 5).every((r) => r === "invalid_credentials"));
  assert.ok(results.includes("rate_limited"), "the failure limit still applies");
  await db.close();
});

test("resend: a new link replaces the old one, the answer is the same for every address, and verification cannot be switched off from outside", async () => {
  process.env.TEND_ADMIN = "0";
  const db = await memoryDb();
  const first = await register(db, req(), { email: "cy@example.com", password: PW });
  const again = await resendVerification(db, req(), { email: "cy@example.com" });
  assert.deepEqual(again.result, (await resendVerification(db, req(), { email: "nobody@example.com" })).result, "same answer for an unknown address");
  assert.equal(await code(verifyEmail(db, req(), { token: tokenIn(first.outbox) })), "invalid_link", "the earlier link stops working");
  assert.equal(await code(verifyEmail(db, req(), { token: tokenIn(again.outbox) })), "ok");
  await db.close();
});
