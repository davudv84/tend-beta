// Second factor for accounts: TOTP (RFC 6238, the authenticator apps' standard) through otplib, a maintained library. Nothing here implements
// the algorithm. What this module adds: the secret encrypted at rest (AES-256-GCM, TEND_MFA_KEY), replay protection (a code's time step is
// spent once), one-time recovery codes stored as hashes, and the audit trail. Sign-in asks for the code after the password and before the
// failed-attempt budget is given back, so knowing the password does not open unlimited guessing of codes.
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { generateSecret, generateURI, verify } from "otplib";
import { config } from "./config.ts";
import { HttpError } from "./http.ts";
import { audit, type Session } from "./session.ts";
import type { Q } from "./db.ts";

const RECOVERY_CODES = 10;
/** ±1 time step (30 s), what authenticator apps need for a slightly wrong clock. */
const TOLERANCE = 30;
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

function key(): Buffer | undefined {
  const raw = config.mfaKey;
  return raw ? createHash("sha256").update(raw, "utf8").digest() : undefined;
}
/** Production needs TEND_MFA_KEY: a TOTP secret in the database is as good as the second factor itself. Development may store it as is. */
function seal(secret: string) {
  const k = key();
  if (!k) {
    if (process.env.NODE_ENV === "production") throw new HttpError(503, "mfa_unavailable", "Two-step sign-in is not configured on this server (TEND_MFA_KEY).");
    return `plain.${secret}`;
  }
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([c.update(secret, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${ct.toString("base64url")}`;
}
function unseal(stored: string): string {
  const [v, a, b, c] = stored.split(".");
  if (v === "plain" && process.env.NODE_ENV !== "production") return a;
  const k = key();
  if (v !== "v1" || !k) throw new HttpError(503, "mfa_unavailable", "Two-step sign-in cannot be checked on this server (TEND_MFA_KEY missing or changed).");
  const d = createDecipheriv("aes-256-gcm", k, Buffer.from(a, "base64url"));
  d.setAuthTag(Buffer.from(b, "base64url"));
  return Buffer.concat([d.update(Buffer.from(c, "base64url")), d.final()]).toString("utf8");
}

interface MfaRow { user_id: string; secret: string; enabled_at: number | null; last_step: number | null; recovery: string }
const row = (q: Q, userId: string) => q.get<MfaRow>("SELECT * FROM user_mfa WHERE user_id = ?", userId);

export async function mfaStatus(q: Q, userId: string) {
  const r = await row(q, userId);
  return { enabled: !!r?.enabled_at, recoveryCodesLeft: r?.enabled_at ? (JSON.parse(r.recovery) as string[]).length : 0 };
}

/** Starts (or restarts) enrolment: a new secret, not yet required at sign-in. Returns what the authenticator app needs, once. */
export async function startEnrollment(q: Q, s: Session, now = Date.now()) {
  if (!s.userId) throw new HttpError(400, "not_an_account", "The admin token cannot use two-step sign-in. Sign in with an account.");
  if ((await row(q, s.userId))?.enabled_at) throw new HttpError(409, "mfa_enabled", "Two-step sign-in is already on. Turn it off first to set up a new authenticator.");
  const secret = generateSecret(); // Base32, 20 bytes
  await q.run("INSERT INTO user_mfa (user_id, secret, created_at) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET secret = EXCLUDED.secret, enabled_at = NULL, last_step = NULL, recovery = '[]', created_at = EXCLUDED.created_at",
    s.userId, seal(secret), now);
  return { secret, uri: generateURI({ issuer: "TEND", label: s.email ?? s.userId, secret }) };
}

/** Checks a TOTP code and spends its time step (a code works once). */
async function spendCode(q: Q, r: MfaRow, code: string, now: number) {
  if (!/^[0-9]{6}$/.test(code)) return false;
  const res = await verify({ secret: unseal(r.secret), token: code, epochTolerance: TOLERANCE, epoch: Math.floor(now / 1000), ...(r.last_step !== null && { afterTimeStep: Number(r.last_step) }) });
  if (!res.valid || !("timeStep" in res) || typeof res.timeStep !== "number") return false; // a TOTP result always carries its time step
  // Atomic: two requests with the same code at the same moment cannot both pass.
  return (await q.run("UPDATE user_mfa SET last_step = ? WHERE user_id = ? AND (last_step IS NULL OR last_step < ?)", res.timeStep, r.user_id, res.timeStep)) === 1;
}
async function spendRecovery(q: Q, r: MfaRow, code: string) {
  const want = sha(code.replace(/[\s-]/g, "").toUpperCase());
  const left = JSON.parse(r.recovery) as string[];
  const hit = left.find((h) => h.length === want.length && timingSafeEqual(Buffer.from(h), Buffer.from(want)));
  if (!hit) return false;
  return (await q.run("UPDATE user_mfa SET recovery = ? WHERE user_id = ? AND recovery = ?", JSON.stringify(left.filter((h) => h !== hit)), r.user_id, r.recovery)) === 1;
}

/** Turns two-step sign-in on with a first code from the app. Returns recovery codes, shown once. Other sessions of the account end. */
export async function confirmEnrollment(q: Q, s: Session, code: unknown, now = Date.now()) {
  const r = s.userId ? await row(q, s.userId) : undefined;
  if (!r || r.enabled_at) throw new HttpError(409, "mfa_not_pending", "Start the setup first.");
  if (typeof code !== "string" || !(await spendCode(q, r, code, now))) throw new HttpError(422, "mfa_invalid", "That code is not right. Check the time on your phone and try the current code.");
  const codes = Array.from({ length: RECOVERY_CODES }, () => randomBytes(8).toString("hex").toUpperCase().replace(/(.{4})(.{4})(.{4})(.{4})/, "$1-$2-$3-$4"));
  await q.run("UPDATE user_mfa SET enabled_at = ?, recovery = ? WHERE user_id = ?", now, JSON.stringify(codes.map((c) => sha(c.replace(/-/g, "")))), s.userId);
  await q.run("UPDATE operator_sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL", now, s.userId, s.id);
  await audit(q, "mfa.enabled", { userId: s.userId!, sessionId: s.id, now });
  return { enabled: true, recoveryCodes: codes };
}

/** Turns it off: needs a current code or a recovery code (the password is checked by the caller). */
export async function disableMfa(q: Q, s: Session, code: unknown, now = Date.now()) {
  const r = s.userId ? await row(q, s.userId) : undefined;
  if (!r?.enabled_at) throw new HttpError(409, "mfa_not_enabled", "Two-step sign-in is not on.");
  if (typeof code !== "string" || !((await spendCode(q, r, code, now)) || (await spendRecovery(q, r, code)))) throw new HttpError(422, "mfa_invalid", "That code is not right.");
  await q.run("DELETE FROM user_mfa WHERE user_id = ?", s.userId);
  await audit(q, "mfa.disabled", { userId: s.userId!, sessionId: s.id, now });
  return { enabled: false };
}

/** At sign-in, after the password: "none" (no second factor set up), "ok", "missing" (ask for it) or "invalid". */
export async function secondFactor(q: Q, userId: string, code: unknown, now = Date.now()): Promise<"none" | "ok" | "missing" | "invalid"> {
  const r = await row(q, userId);
  if (!r?.enabled_at) return "none";
  if (typeof code !== "string" || !code.trim()) return "missing";
  const c = code.trim();
  return (await spendCode(q, r, c, now)) || (c.length > 6 && (await spendRecovery(q, r, c))) ? "ok" : "invalid";
}
