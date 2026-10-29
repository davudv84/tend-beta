// Operator sessions, kept on the server.
//
// A session is a row. The cookie holds "<id>.<secret>": the id is a short public label (the one recorded beside every decision
// an operator makes), the secret is 256 random bits of which only the SHA-256 is stored. So a copy of the database cannot be
// used to sign in, a session can be revoked at any moment and takes effect on the very next request, and nothing about a
// session can be forged, because there is nothing to compute: the secret has to be the one that was issued.
//
// A session is accepted only if all of these hold, checked on every request: the secret matches, it was not revoked, it has not
// expired, and it was issued under the admin token that is configured now (rotating TEND_ADMIN_TOKEN ends every session).
//
// Everything that matters about signing in is recorded in `auth_events` (append-only): who got in, who was turned away and why,
// who signed out, and when a revoked or expired session was presented again. Never the token that was typed, never a secret.
//
// Two kinds of session share the table and the cookie. An admin-token session (user_id NULL) works in the "default" workspace and can
// approve accounts. A user session (accounts.ts) works only in that user's own workspace, and only while the account is verified,
// approved and not disabled, and the password has not changed since the session began: each of these is checked on every request.
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { config } from "./config.ts";
import type { Q } from "./db.ts";
import { cookie, type Viewer } from "./auth.ts";
import { spend } from "./limits.ts";

export const SESSION_TTL = 12 * 60 * 60 * 1000;
/** A user stays signed in for a week on the browser they signed in on (the cookie survives a restart); signing out or a reset ends it. */
export const USER_SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_WORKSPACE = "default";
const USER_EPOCH = "user";
const ID = /^[a-f0-9]{16}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const TOUCH_EVERY = 60_000;

/**
 * True only for a request to a loopback address over plain http, on a server started with TEND_LOCAL_HTTP=1. Nothing else ever gets the
 * relaxed cookie: not another hostname, not a LAN address, not https, not Vercel or a server behind a proxy. HttpOnly and SameSite=Strict stay.
 */
export function plainLoopback(req?: Request) {
  if (!req || !config.localHttp) return false;
  try {
    const u = new URL(req.url);
    return u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
}

/** In production the cookie is `__Host-` prefixed: the browser then refuses it unless it is Secure, host-only and for the whole site, so a sibling subdomain cannot plant one. */
export const sessionCookieName = (req?: Request) => (config.secureCookies && !plainLoopback(req) ? "__Host-tend_operator" : "tend_operator");

const sha = (s: string) => createHash("sha256").update(s).digest();
const sameHash = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

// Which admin token a session was issued under. A slow hash, computed once per token and kept in memory, so the value stored with
// a session is of no use for guessing the token offline.
let epochFor: { token: string; value: string } | undefined;
function epoch() {
  const token = config.adminToken;
  if (!token) return undefined;
  if (epochFor?.token !== token) epochFor = { token, value: scryptSync(token, "tend-session-epoch-v1", 16).toString("hex") };
  return epochFor.value;
}

interface SessionRow { id: string; secret_hash: string; epoch: string; created_at: number; expires_at: number; last_seen_at: number | null; revoked_at: number | null; client: string | null; user_id: string | null }
interface AccountRow { workspace_id: string; email: string; email_verified_at: number | null; approved_at: number | null; disabled_at: number | null; password_changed_at: number }
/** Who a live session acts for: `by` is recorded beside everything it does; `workspace` bounds everything it can see or change. */
export interface Session { id: string; userId: string | null; workspace: string; email?: string; admin: boolean }

export type AuthEventType = "signin.succeeded" | "signin.failed" | "signin.blocked" | "session.signed_out" | "session.revoked_all" | "session.rejected" | "log.suppressed" | "agentkey.rejected"
  | "account.registered" | "account.verified" | "account.approved" | "account.disabled" | "account.reset_requested" | "account.password_reset";
const NEVER_DROPPED = new Set<AuthEventType>(["signin.succeeded", "session.signed_out", "session.revoked_all", "log.suppressed", "account.verified", "account.approved", "account.disabled", "account.password_reset"]);

/**
 * Appends to the authentication log. Successes and sign-outs are always written. Failures, blocks and rejected sessions are the
 * kind of record an attacker can produce at will, so they share one budget per minute: past it, one `log.suppressed` row says
 * so and the rest are dropped, which bounds the table whatever is thrown at the endpoint.
 */
export async function audit(q: Q, type: AuthEventType, o: { sessionId?: string; client?: string; reason?: string; userId?: string; now?: number } = {}) {
  const now = o.now ?? Date.now();
  if (!NEVER_DROPPED.has(type)) {
    // Rejected agent keys have a budget of their own: a flood of wrong keys must not crowd sign-in failures out of the log, or the reverse.
    const key = type === "agentkey.rejected" ? "authlog:noise:agentkey" : "authlog:noise";
    const { n } = await spend(q, key, 60, { now });
    if (n > 61) return;
    if (n === 61) return audit(q, "log.suppressed", { reason: type === "agentkey.rejected" ? "too many rejected agent keys to record one by one" : "too many failures to record one by one", now });
  }
  await q.run("INSERT INTO auth_events (at, type, session_id, client, reason, user_id) VALUES (?, ?, ?, ?, ?, ?)", Math.round(now), type, o.sessionId ?? null, o.client ?? null, o.reason ?? null, o.userId ?? null);
}

/** Issues a session: an admin-token session, or with `userId` one for that account. The cookie value is returned once and never stored. */
export async function createSession(q: Q, { now = Date.now(), client = "unknown", userId }: { now?: number; client?: string; userId?: string } = {}) {
  const e = userId ? USER_EPOCH : epoch();
  if (!e) throw new Error("no usable admin token");
  const ttl = userId ? USER_SESSION_TTL : SESSION_TTL;
  const id = randomBytes(8).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  await q.run("INSERT INTO operator_sessions (id, secret_hash, epoch, created_at, expires_at, client, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)", id, sha(secret).toString("hex"), e, Math.round(now), Math.round(now + ttl), client, userId ?? null);
  if (Math.random() < 0.05) await q.run("DELETE FROM operator_sessions WHERE expires_at < ?", Math.round(now - 30 * 86_400_000)); // long-dead rows only
  return { id, value: `${id}.${secret}`, expiresAt: now + ttl, ttl };
}

/** The live session this request carries, or undefined. Refuses everything else, and notes a revoked or expired session being presented again. */
export async function currentSession(q: Q, req: Request, now = Date.now()): Promise<Session | undefined> {
  const e = epoch();
  const raw = cookie(req, sessionCookieName(req));
  if (!raw) return undefined;
  const [id, secret, ...extra] = raw.split(".");
  if (extra.length || !ID.test(id ?? "") || !SECRET.test(secret ?? "")) return undefined;
  const row = await q.get<SessionRow>("SELECT * FROM operator_sessions WHERE id = ?", id);
  if (!row) return undefined; // an id nobody was issued: nothing to say about it
  const reason = !sameHash(sha(secret), Buffer.from(row.secret_hash, "hex")) ? "wrong_secret"
    : row.revoked_at !== null ? "revoked"
    : Number(row.expires_at) <= now ? "expired"
    : row.user_id === null && row.epoch !== e ? "admin_token_changed"
    : undefined;
  const account = !reason && row.user_id !== null ? await q.get<AccountRow>("SELECT workspace_id, email, email_verified_at, approved_at, disabled_at, password_changed_at FROM users WHERE id = ?", row.user_id) : undefined;
  const accountReason = reason || row.user_id === null ? undefined
    : !account ? "account_gone" : account.disabled_at !== null ? "account_disabled" : account.email_verified_at === null ? "email_unverified"
    : account.approved_at === null ? "not_approved" : Number(account.password_changed_at) > Number(row.created_at) ? "password_changed" : undefined;
  // A session issued under another admin token is ended for good, so putting the old token back cannot bring it back to life.
  if (reason === "admin_token_changed") await q.run("UPDATE operator_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", Math.round(now), id);
  if (reason || accountReason) {
    const why = (reason ?? accountReason)!;
    // Once an hour per session and reason, so a browser that keeps sending an old cookie does not fill the log.
    if ((await spend(q, `authlog:rejected:${id}:${why}`, 1, { windowMs: 3_600_000, now })).ok) await audit(q, "session.rejected", { sessionId: id, reason: why, ...(row.user_id && { userId: row.user_id }), now });
    return undefined;
  }
  if (row.last_seen_at === null || Number(row.last_seen_at) < now - TOUCH_EVERY) await q.run("UPDATE operator_sessions SET last_seen_at = ? WHERE id = ? AND revoked_at IS NULL", Math.round(now), id);
  return account ? { id, userId: row.user_id, workspace: account.workspace_id, email: account.email, admin: false } : { id, userId: null, workspace: DEFAULT_WORKSPACE, admin: true };
}

/** The id of the live session this request carries, or undefined. */
export const activeSession = async (q: Q, req: Request, now = Date.now()) => (await currentSession(q, req, now))?.id;
export const isOperator = async (q: Q, req: Request, now = Date.now()) => (await activeSession(q, req, now)) !== undefined;

/** Ends one session. Needs the secret too: an id on its own (it appears in the activity log) cannot sign anyone out. */
export async function signOut(q: Q, req: Request, now = Date.now()) {
  const raw = cookie(req, sessionCookieName(req));
  const [id, secret] = raw?.split(".") ?? [];
  if (!ID.test(id ?? "") || !SECRET.test(secret ?? "")) return false;
  const row = await q.get<SessionRow>("SELECT * FROM operator_sessions WHERE id = ?", id);
  if (!row || !sameHash(sha(secret), Buffer.from(row.secret_hash, "hex"))) return false;
  const ended = await q.run("UPDATE operator_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", Math.round(now), id);
  if (ended) await audit(q, "session.signed_out", { sessionId: id, now });
  return ended > 0;
}

/** Ends every live session of the same kind, this one included: a user's own sessions, or (for the admin) every admin-token session. The answer to "someone else may have my cookie". */
export async function revokeAll(q: Q, by: string | Session, now = Date.now()) {
  const s = typeof by === "string" ? { id: by, userId: null } : by;
  const n = s.userId
    ? await q.run("UPDATE operator_sessions SET revoked_at = ? WHERE revoked_at IS NULL AND expires_at > ? AND user_id = ?", Math.round(now), Math.round(now), s.userId)
    : await q.run("UPDATE operator_sessions SET revoked_at = ? WHERE revoked_at IS NULL AND expires_at > ? AND user_id IS NULL", Math.round(now), Math.round(now));
  await audit(q, "session.revoked_all", { sessionId: s.id, reason: `${n} ended`, ...(s.userId && { userId: s.userId }), now });
  return n;
}

/** What is shown about sign-ins: a user sees only their own sessions and log; the admin sees the admin sessions and the whole log. Nothing secret exists to show. */
export async function sessionOverview(q: Q, current: string | Session, now = Date.now()) {
  const s = typeof current === "string" ? { id: current, userId: null } : current;
  const mine = s.userId ? "user_id = ?" : "user_id IS NULL";
  const sessions = (await q.all<SessionRow>(`SELECT * FROM operator_sessions WHERE revoked_at IS NULL AND expires_at > ? AND ${mine} ORDER BY created_at DESC LIMIT 50`, Math.round(now), ...(s.userId ? [s.userId] : [])))
    .map((r) => ({ id: r.id, createdAt: Number(r.created_at), lastSeenAt: r.last_seen_at === null ? null : Number(r.last_seen_at), expiresAt: Number(r.expires_at), client: r.client, current: r.id === s.id }));
  const recent = (await q.all<{ at: number; type: AuthEventType; session_id: string | null; client: string | null; reason: string | null }>(
    `SELECT at, type, session_id, client, reason FROM auth_events ${s.userId ? "WHERE user_id = ?" : ""} ORDER BY seq DESC LIMIT 30`, ...(s.userId ? [s.userId] : [])))
    .map((e) => ({ at: Number(e.at), type: e.type, sessionId: e.session_id, client: e.client, reason: e.reason }));
  return { sessions, recent };
}

export function sessionHeader(value: string, maxAgeMs: number, req?: Request) {
  const secure = config.secureCookies && !plainLoopback(req);
  return [
    `${sessionCookieName(req)}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export async function viewerOf(q: Q, req: Request): Promise<Viewer> {
  const s = await currentSession(q, req);
  return {
    role: s ? "operator" : "visitor", canAct: !!s, public: config.public, operatorAvailable: !!config.adminToken, demo: config.demo,
    workspace: s?.workspace ?? DEFAULT_WORKSPACE, admin: !!s?.admin, accounts: config.accounts, ...(s?.email && { account: { email: s.email } }),
  };
}
