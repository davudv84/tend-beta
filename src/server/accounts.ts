// E-mail accounts for the private beta. Each account gets its own workspace: its agents, keys, policies, approvals and audit log are
// visible and changeable only there (repo.ts agentInWorkspace and friends, sync.ts). Agent API keys are a separate credential and work as before.
//
// Life of an account: register → verify the e-mail address (a one-time link) → the admin approves it → sign in. A session is issued only
// to a verified, approved, enabled account, and every request re-checks all three (session.ts), so disabling or a password reset takes
// effect at once.
//
// What a caller can learn: nothing about which addresses have accounts. Registering, asking for a new link and asking for a reset all give
// the same answer whatever the address; a wrong address and a wrong password give the same error, after the same password work. Only someone
// who knows the password is told that the address is unverified or that approval is pending.
//
// Secrets: passwords are hashed with scrypt (Node's crypto; N=2^15, r=8, p=1, a 16-byte salt). Verification and reset tokens are 256 random
// bits, stored only as SHA-256, valid once (24 hours and 30 minutes), and sent only in a link to the address on the account. Nothing here
// logs a password, a token or a link.
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { config } from "./config.ts";
import type { DB, Q } from "./db.ts";
import { sendMail, type Mail, type Send } from "./email.ts";
import { clientIp, HttpError } from "./http.ts";
import { spend } from "./limits.ts";
import { allAgents, revokeKey } from "./repo.ts";
import { audit, createSession, signOut } from "./session.ts";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const COST = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const PASSWORD = { min: 10, max: 200 };
export const TOKEN_TTL = { verify: 24 * 3_600_000, reset: 30 * 60_000 };
export const LIMITS = {
  /** Per address: wrong passwords, and accounts created, per hour. */
  signInFailuresPerMinute: 10, registrationsPerHour: 5,
  /** Per e-mail address: wrong passwords per hour (slows guessing one account from many addresses), mails of each kind per hour. */
  failuresPerAccountPerHour: 20, mailsPerAccountPerHour: 3,
};
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const HOUR = 3_600_000;

export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const key = await scryptAsync(pw, salt, 32, COST);
  return `scrypt$15$8$1$${salt.toString("base64url")}$${key.toString("base64url")}`;
}
export async function checkPassword(pw: string, stored: string) {
  const [alg, n, r, p, salt, key] = stored.split("$");
  if (alg !== "scrypt" || !salt || !key) return false;
  const want = Buffer.from(key, "base64url");
  const got = await scryptAsync(pw, Buffer.from(salt, "base64url"), want.length, { N: 2 ** Number(n), r: Number(r), p: Number(p), maxmem: COST.maxmem });
  return got.length === want.length && timingSafeEqual(got, want);
}
// For an address without an account, the same password work is done against this, so the answer takes as long either way.
let dummy: Promise<string> | undefined;
const dummyHash = () => (dummy ??= hashPassword(randomBytes(16).toString("hex")));

const cleanEmail = (v: unknown) => {
  const e = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (e.length > 254 || !EMAIL.test(e)) throw new HttpError(422, "invalid_email", "Enter a valid e-mail address.");
  return e;
};
export function passwordProblem(pw: unknown, email?: string) {
  if (typeof pw !== "string" || pw.length < PASSWORD.min) return `Use at least ${PASSWORD.min} characters.`;
  if (pw.length > PASSWORD.max) return `Use at most ${PASSWORD.max} characters.`;
  if (new Set(pw).size < 5) return "Use a less repetitive password.";
  if (email && pw.toLowerCase().includes(email.split("@")[0]) && email.split("@")[0].length >= 4) return "Don’t use your e-mail address in the password.";
  return undefined;
}

interface UserRow { id: string; email: string; password_hash: string; workspace_id: string; created_at: number; email_verified_at: number | null; approved_at: number | null; approved_by: string | null; disabled_at: number | null; password_changed_at: number }
const userByEmail = (q: Q, email: string) => q.get<UserRow>("SELECT * FROM users WHERE email = ?", email);

/** Where links in mails point. Configured in production (config.appUrl), never read from the request there; locally the request's own origin. */
function base(req?: Request) {
  if (config.appUrl) return config.appUrl;
  if ((process.env.NODE_ENV === "production" && !config.localHttp) || !req) throw new HttpError(503, "accounts_disabled", "Accounts are not configured on this server.");
  return new URL(req.url).origin;
}
function requireAccounts() {
  if (!config.accounts) throw new HttpError(503, "accounts_disabled", "Accounts are not enabled on this server.");
}

/** A fresh one-time token for this user and purpose; any older unused one of the same purpose stops working. */
async function issueToken(q: Q, userId: string, purpose: "verify" | "reset", now: number) {
  const token = randomBytes(32).toString("base64url");
  await q.run("UPDATE user_tokens SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL", now, userId, purpose);
  await q.run("INSERT INTO user_tokens (hash, user_id, purpose, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", sha(token), userId, purpose, now, now + TOKEN_TTL[purpose]);
  return token;
}
/** Spends a token: the user it belongs to, or a 400. Malformed, unknown, used and expired tokens all get the same answer. */
async function spendToken(q: Q, token: unknown, purpose: "verify" | "reset", now: number) {
  const bad = new HttpError(400, "invalid_link", "This link is not valid any more. Ask for a new one.");
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw bad;
  const row = await q.get<{ user_id: string }>("UPDATE user_tokens SET used_at = ? WHERE hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ? RETURNING user_id", now, sha(token), purpose, now);
  if (!row) throw bad;
  return row.user_id;
}

const mails = {
  verify: (to: string, link: string): Mail => ({ to, subject: "Confirm your e-mail address for TEND", text: `Confirm your e-mail address to finish creating your TEND account:\n\n${link}\n\nThe link works once, for 24 hours. If you did not sign up for TEND, ignore this mail.` }),
  exists: (to: string, link: string): Mail => ({ to, subject: "Your TEND account", text: `Someone tried to create a TEND account with this address, which already has one.\n\nSign in: ${link}/account/sign-in\nForgot your password? ${link}/account/forgot\n\nIf it was not you, you can ignore this mail.` }),
  reset: (to: string, link: string): Mail => ({ to, subject: "Reset your TEND password", text: `Choose a new password for your TEND account:\n\n${link}\n\nThe link works once, for 30 minutes. Your other sessions are signed out when you use it. If you did not ask for this, ignore this mail; your password stays as it is.` }),
  approved: (to: string, link: string): Mail => ({ to, subject: "Your TEND beta access is ready", text: `Your TEND account has been approved. Sign in: ${link}/account/sign-in\n\nThen connect your first agent: ${link}/integrations` }),
  waiting: (to: string, who: string, link: string): Mail => ({ to, subject: "A TEND account is waiting for approval", text: `${who} confirmed their e-mail address and is waiting for beta access.\n\nApprove or decline: ${link}/admin/users` }),
};
export type Outbox = Mail[];

/** Mails go out after the answer is decided (the route sends them after responding), so how long a request takes says nothing about the address. */
export async function deliver(outbox: Outbox, send: Send = sendMail) {
  for (const m of outbox) await send(m).catch((e) => console.error("[tend] could not send mail:", (e as Error).message));
}

const sent = { ok: true, message: "If the address can be used, a mail is on its way. Check your inbox." };

/** Sign up. Always the same answer; what is mailed depends on the address (a link to confirm it, or a note that it already has an account). */
export async function register(db: DB, req: Request, input: unknown, now = Date.now()): Promise<{ result: typeof sent; outbox: Outbox }> {
  requireAccounts();
  const o = (input ?? {}) as { email?: unknown; password?: unknown };
  const email = cleanEmail(o.email);
  const problem = passwordProblem(o.password, email);
  if (problem) throw new HttpError(422, "weak_password", problem);
  const client = clientIp(req);
  if (!(await spend(db, `account:register:${client}`, LIMITS.registrationsPerHour, { windowMs: HOUR, now })).ok)
    throw new HttpError(429, "rate_limited", "Too many sign-ups from this address. Try again later.", { retryAfter: 3600 });
  const link = base(req);
  const hash = await hashPassword(o.password as string); // always, so an existing address is not answered faster
  const outbox: Outbox = [];
  const existing = await userByEmail(db, email);
  const mailOk = (await spend(db, `account:mail:${email}`, LIMITS.mailsPerAccountPerHour, { windowMs: HOUR, now })).ok;
  if (existing) {
    if (mailOk && existing.email_verified_at === null) outbox.push(mails.verify(email, `${link}/account/verify#token=${await issueToken(db, existing.id, "verify", now)}`));
    else if (mailOk) outbox.push(mails.exists(email, link));
    return { result: sent, outbox };
  }
  const id = `u_${randomUUID().replaceAll("-", "").slice(0, 20)}`, workspace = `ws_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const token = await db.tx(async (q) => {
    await q.run("INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)", workspace, email, now);
    await q.run("INSERT INTO users (id, email, password_hash, workspace_id, created_at, password_changed_at) VALUES (?, ?, ?, ?, ?, ?)", id, email, hash, workspace, now, now);
    await audit(q, "account.registered", { userId: id, client, now });
    return issueToken(q, id, "verify", now);
  }).catch(async (e) => {
    // Two sign-ups with one address at the same moment: the second is answered like any existing address.
    if (String((e as Error).message).includes("users_email_key")) return null;
    throw e;
  });
  if (token) outbox.push(mails.verify(email, `${link}/account/verify#token=${token}`));
  return { result: sent, outbox };
}

/** Confirms the address. The admin is told (if TEND_ADMIN_EMAIL is set) that someone waits for approval. */
export async function verifyEmail(db: DB, req: Request, input: unknown, now = Date.now()) {
  requireAccounts();
  return db.tx(async (q) => {
    const userId = await spendToken(q, (input as { token?: unknown } | null)?.token, "verify", now);
    const u = (await q.get<UserRow>("SELECT * FROM users WHERE id = ?", userId))!;
    const outbox: Outbox = [];
    if (u.email_verified_at === null) {
      await q.run("UPDATE users SET email_verified_at = ? WHERE id = ?", now, userId);
      await audit(q, "account.verified", { userId, now });
      if (config.adminEmail && u.approved_at === null) outbox.push(mails.waiting(config.adminEmail, u.email, base(req)));
    }
    return { result: { ok: true, approved: u.approved_at !== null }, outbox };
  });
}

/** A new confirmation link, for an address that has an unverified account. Same answer for every address. */
export async function resendVerification(db: DB, req: Request, input: unknown, now = Date.now()) {
  requireAccounts();
  const email = cleanEmail((input as { email?: unknown } | null)?.email);
  const outbox: Outbox = [];
  const u = await userByEmail(db, email);
  if (u && u.email_verified_at === null && (await spend(db, `account:mail:${email}`, LIMITS.mailsPerAccountPerHour, { windowMs: HOUR, now })).ok)
    outbox.push(mails.verify(email, `${base(req)}/account/verify#token=${await issueToken(db, u.id, "verify", now)}`));
  return { result: sent, outbox };
}

/**
 * Password sign-in. Wrong address and wrong password are one error. Failures are counted per caller address and per account; past either
 * budget the caller is refused until it resets, which bounds guessing. A correct password on an account that is not ready yet is told why.
 */
export async function passwordSignIn(db: DB, req: Request, input: unknown, now = Date.now()) {
  requireAccounts();
  const client = clientIp(req);
  const o = (input ?? {}) as { email?: unknown; password?: unknown };
  const email = typeof o.email === "string" ? o.email.trim().toLowerCase().slice(0, 254) : "";
  const password = typeof o.password === "string" ? o.password.slice(0, PASSWORD.max) : "";
  const perClient = await spend(db, `account:fail:${client}`, LIMITS.signInFailuresPerMinute, { now });
  const perAccount = await spend(db, `account:fail:${email}`, LIMITS.failuresPerAccountPerHour, { windowMs: HOUR, now });
  if ((client !== "unknown" && !perClient.ok) || !perAccount.ok) {
    await audit(db, "signin.blocked", { client, reason: perAccount.ok ? "too_many_failures" : "too_many_failures_for_account", now });
    throw new HttpError(429, "rate_limited", "Too many failed sign-in attempts. Try again later.", { retryAfter: perAccount.ok ? 60 : 3600 });
  }
  const u = email ? await userByEmail(db, email) : undefined;
  const ok = u ? await checkPassword(password, u.password_hash) : (await checkPassword(password, await dummyHash()), false);
  if (!u || !ok) {
    await audit(db, "signin.failed", { client, reason: "invalid_credentials", ...(u && { userId: u.id }), now });
    throw new HttpError(401, "invalid_credentials", "That e-mail address and password don’t match an account.");
  }
  // The password was right: give the failures back.
  await spend(db, `account:fail:${client}`, LIMITS.signInFailuresPerMinute, { now, cost: -1 });
  await spend(db, `account:fail:${email}`, LIMITS.failuresPerAccountPerHour, { windowMs: HOUR, now, cost: -1 });
  if (u.disabled_at !== null) throw new HttpError(403, "account_disabled", "This account has been disabled. Contact the TEND admin.");
  if (u.email_verified_at === null) throw new HttpError(403, "email_unverified", "Confirm your e-mail address first. We can send the link again.");
  if (u.approved_at === null) throw new HttpError(403, "pending_approval", "Your account is waiting for approval. You’ll get an e-mail when it’s ready.");
  await signOut(db, req, now); // a sign-in replaces the session this browser already held
  return db.tx(async (q) => {
    const s = await createSession(q, { now, client, userId: u.id });
    await audit(q, "signin.succeeded", { sessionId: s.id, client, userId: u.id, now });
    return s;
  });
}

/** Forgot password. Same answer for every address; only an existing, enabled account gets a link. */
export async function requestReset(db: DB, req: Request, input: unknown, now = Date.now()) {
  requireAccounts();
  const email = cleanEmail((input as { email?: unknown } | null)?.email);
  const outbox: Outbox = [];
  const client = clientIp(req);
  const perClient = await spend(db, `account:reset:${client}`, 10, { windowMs: HOUR, now });
  const u = await userByEmail(db, email);
  if (perClient.ok && u && u.disabled_at === null && (await spend(db, `account:resetmail:${email}`, LIMITS.mailsPerAccountPerHour, { windowMs: HOUR, now })).ok) {
    outbox.push(mails.reset(email, `${base(req)}/account/reset#token=${await issueToken(db, u.id, "reset", now)}`));
    await audit(db, "account.reset_requested", { userId: u.id, client, now });
  }
  return { result: sent, outbox };
}

/** Sets a new password from a reset link: every session of the account ends, other reset links stop working, and the address counts as confirmed. */
export async function resetPassword(db: DB, input: unknown, now = Date.now()) {
  requireAccounts();
  const o = (input ?? {}) as { token?: unknown; password?: unknown };
  const hash = typeof o.password === "string" && !passwordProblem(o.password) ? await hashPassword(o.password) : null;
  return db.tx(async (q) => {
    const userId = await spendToken(q, o.token, "reset", now);
    const u = (await q.get<UserRow>("SELECT * FROM users WHERE id = ?", userId))!;
    const problem = passwordProblem(o.password, u.email);
    if (problem || !hash) throw new HttpError(422, "weak_password", problem ?? "Choose another password.");
    if (u.disabled_at !== null) throw new HttpError(400, "invalid_link", "This link is not valid any more. Ask for a new one.");
    await q.run("UPDATE users SET password_hash = ?, password_changed_at = ?, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?", hash, now, now, userId);
    await q.run("UPDATE user_tokens SET used_at = ? WHERE user_id = ? AND purpose = 'reset' AND used_at IS NULL", now, userId);
    await q.run("UPDATE operator_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", now, userId);
    await audit(q, "account.password_reset", { userId, now });
    return { ok: true };
  });
}

// ---- the admin -----------------------------------------------------------------------------------------------------------------------

export async function listUsers(q: Q) {
  return (await q.all<UserRow & { agents: number }>("SELECT u.*, (SELECT COUNT(*) FROM agents a WHERE a.workspace_id = u.workspace_id) AS agents FROM users u ORDER BY u.created_at DESC LIMIT 500"))
    .map((u) => ({ id: u.id, email: u.email, createdAt: Number(u.created_at), verifiedAt: u.email_verified_at === null ? null : Number(u.email_verified_at), approvedAt: u.approved_at === null ? null : Number(u.approved_at), disabledAt: u.disabled_at === null ? null : Number(u.disabled_at), agents: Number(u.agents) }));
}

/** Approve (the user is mailed), disable (every session ends and every agent key of the workspace is revoked, at once), or enable again (keys stay revoked: the user issues new ones). */
export async function setAccess(db: DB, req: Request, userId: string, action: unknown, by: string, now = Date.now()) {
  if (!["approve", "disable", "enable"].includes(action as string)) throw new HttpError(422, "invalid_action", "action must be approve, disable or enable.");
  const result = await db.tx(async (q) => {
    const u = await q.get<UserRow>("SELECT * FROM users WHERE id = ? FOR UPDATE", userId);
    if (!u) throw new HttpError(404, "user_not_found", "No account with that id.");
    const outbox: Outbox = [];
    if (action === "approve") {
      if (u.email_verified_at === null) throw new HttpError(409, "email_unverified", "This address is not confirmed yet, so it cannot be approved.");
      if (u.approved_at === null) {
        await q.run("UPDATE users SET approved_at = ?, approved_by = ?, disabled_at = NULL WHERE id = ?", now, by, userId);
        await audit(q, "account.approved", { userId, sessionId: by, now });
        outbox.push(mails.approved(u.email, base(req)));
      }
    } else if (action === "disable") {
      await q.run("UPDATE users SET disabled_at = COALESCE(disabled_at, ?) WHERE id = ?", now, userId);
      await q.run("UPDATE operator_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", now, userId);
      await audit(q, "account.disabled", { userId, sessionId: by, now });
    } else await q.run("UPDATE users SET disabled_at = NULL WHERE id = ?", userId);
    return { user: (await listUsers(q)).find((x) => x.id === userId), outbox, workspace: u.workspace_id };
  });
  if (action === "disable") for (const a of await allAgents(db, result.workspace)) if (a.origin === "connected") await revokeKey(db, a.id, by);
  return { user: result.user, outbox: result.outbox };
}
