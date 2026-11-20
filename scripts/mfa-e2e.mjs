#!/usr/bin/env node
// Two-step sign-in end to end, against a production build (with TEND_E2E_DATABASE_URL: on PostgreSQL with RLS and a restricted login):
// set up and turn on over the API, then sign in in a real browser (Chromium via Playwright): the code field appears only after the right
// password, a wrong code is refused, the right one gets in. Codes are computed here with an independent RFC 6238 reference.
import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { startIsolatedServer } from "./isolated-server.mjs";

const root = path.resolve(import.meta.dirname, "..");
const dataDir = mkdtempSync(path.join(tmpdir(), "tend-mfa-"));
const ADMIN = `mfa_admin_${randomBytes(24).toString("hex")}`;
const server = await startIsolatedServer({ root, env: { TEND_ADMIN_TOKEN: ADMIN, TEND_DATA_DIR: dataDir, TEND_MFA_KEY: randomBytes(32).toString("base64url") } });
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const unb32 = (s) => { let bits = ""; for (const c of s) bits += B32.indexOf(c).toString(2).padStart(5, "0"); return Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2))); };
const totp = (secret, t = Date.now() / 1000) => { const m = Buffer.alloc(8); m.writeBigUInt64BE(BigInt(Math.floor(t / 30))); const h = createHmac("sha1", unb32(secret)).update(m).digest(); const o = h[19] & 0xf; return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0"); };
const api = async (m, p, { body, cookie } = {}) => { const r = await fetch(server.url + p, { method: m, redirect: "manual", headers: { ...(body && { "content-type": "application/json" }), ...(cookie && { cookie }) }, body: body && JSON.stringify(body) }); const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch {} return { status: r.status, body: j, cookie: r.headers.get("set-cookie")?.split(";")[0] }; };
const mail = async (to) => { for (const end = Date.now() + 20_000; Date.now() < end; await new Promise((r) => setTimeout(r, 150))) { try { const f = readdirSync(path.join(dataDir, "outbox")).filter((x) => x.includes(to)).sort().at(-1); if (f) return readFileSync(path.join(dataDir, "outbox", f), "utf8"); } catch {} } return ""; };
let passed = 0, failed = 0;
const check = (ok, text, ev = "") => { ok ? passed++ : failed++; console.log(`${ok ? "ok  " : "FAIL"} ${text}${ok ? "" : `  (${ev})`}`); };
const PW = "correct horse battery staple 42";
let browser;
// Playwright is not a project dependency: the one installed on this machine (require resolves NODE_PATH; import does not), else skip the browser part.
const chromium = (() => { try { return createRequire(import.meta.url)("playwright").chromium; } catch { return undefined; } })();
try {
  const email = `mfa-${randomBytes(4).toString("hex")}@example.com`;
  await api("POST", "/api/account/register", { body: { email, password: PW } });
  await api("POST", "/api/account/verify", { body: { token: /#token=([A-Za-z0-9_-]{43})/.exec(await mail(email))?.[1], password: PW } });
  const admin = (await api("POST", "/api/operator/session", { body: { token: ADMIN } })).cookie;
  const u = (await api("GET", "/api/admin/users", { cookie: admin })).body.users.find((x) => x.email === email);
  await api("POST", `/api/admin/users/${u.id}`, { cookie: admin, body: { action: "approve" } });
  const cookie = (await api("POST", "/api/account/sign-in", { body: { email, password: PW } })).cookie;
  const setup = await api("POST", "/api/account/mfa", { cookie, body: { action: "setup" } });
  check(setup.status === 200 && /^[A-Z2-7]{32}$/.test(setup.body?.secret ?? ""), "setup returns a Base32 secret and an otpauth link", setup.status);
  check((await api("POST", "/api/account/mfa", { cookie, body: { action: "enable", code: "000000" } })).status === 422, "a wrong first code does not turn it on");
  const on = await api("POST", "/api/account/mfa", { cookie, body: { action: "enable", code: totp(setup.body.secret) } });
  check(on.status === 200 && on.body?.recoveryCodes?.length === 10, "the right code turns it on and returns 10 recovery codes", on.status);
  check((await api("POST", "/api/account/sign-in", { body: { email, password: PW } })).body?.error === "mfa_required", "API sign-in with the password alone: mfa_required");
  check((await api("POST", "/api/account/sign-in", { body: { email, password: "wrong wrong wrong 1" } })).body?.error === "invalid_credentials", "a wrong password does not reveal that a code is needed");
  // the browser
  if (!chromium) throw new Error("playwright is not installed: browser part NOT RUN");
  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(server.url + "/account/sign-in");
  await page.getByLabel(/e-mail/i).fill(email);
  await page.getByLabel(/^password/i).fill(PW);
  await page.getByRole("button", { name: /sign in/i }).click();
  const codeField = page.getByLabel(/code from your authenticator app/i);
  await codeField.waitFor({ timeout: 15_000 });
  check(await codeField.isVisible(), "browser: the code field appears after the right password");
  await codeField.fill("123456");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.getByRole("alert").or(page.locator("[role=alert]")).first().waitFor({ timeout: 15_000 }).catch(() => {});
  check(page.url().includes("/account/sign-in"), "browser: a wrong code keeps you on the sign-in page", page.url());
  // a fresh time step, so the code that turned it on is not reused
  await new Promise((r) => setTimeout(r, 31_000 - (Date.now() % 30_000)));
  await codeField.fill(totp(setup.body.secret));
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/home/, { timeout: 20_000 }).catch(() => {});
  check(page.url().includes("/home"), "browser: the right code signs in", page.url());
} catch (e) { failed++; console.log("FAIL harness:", e.message); }
finally { await browser?.close(); await server.stop(); }
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
