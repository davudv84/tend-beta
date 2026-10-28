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
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { config } from "./config.ts";
import type { Q } from "./db.ts";
import { cookie, type Viewer } from "./auth.ts";
import { spend } from "./limits.ts";

export const SESSION_TTL = 12 * 60 * 60 * 1000;
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

interface SessionRow { id: string; secret_hash: string; epoch: string; created_at: number; expires_at: number; last_seen_at: number | null; revoked_at: number | null; client: string | null }

export type AuthEventType = "signin.succeeded" | "signin.failed" | "signin.blocked" | "session.signed_out" | "session.revoked_all" | "session.rejected" | "log.suppressed" | "agentkey.rejected";
const NEVER_DROPPED = new Set<AuthEventType>(["signin.succeeded", "session.signed_out", "session.revoked_all", "log.suppressed"]);

/**
 * Appends to the authentication log. Successes and sign-outs are always written. Failures, blocks and rejected sessions are the
 * kind of record an attacker can produce at will, so they share one budget per minute: past it, one `log.suppressed` row says
 * so and the rest are dropped, which bounds the table whatever is thrown at the endpoint.
 */
export async function audit(q: Q, type: AuthEventType, o: { sessionId?: string; client?: string; reason?: string; now?: number } = {}) {
  const now = o.now ?? Date.now();
  if (!NEVER_DROPPED.has(type)) {
    // Rejected agent keys have a budget of their own: a flood of wrong keys must not crowd sign-in failures out of the log, or the reverse.
    const key = type === "agentkey.rejected" ? "authlog:noise:agentkey" : "authlog:noise";
    const { n } = await spend(q, key, 60, { now });
    if (n > 61) return;
    if (n === 61) return audit(q, "log.suppressed", { reason: type === "agentkey.rejected" ? "too many rejected agent keys to record one by one" : "too many failures to record one by one", now });
  }
  await q.run("INSERT INTO auth_events (at, type, session_id, client, reason) VALUES (?, ?, ?, ?, ?)", Math.round(now), type, o.sessionId ?? null, o.client ?? null, o.reason ?? null);
}

/** Issues a session. The cookie value is returned once and never stored. */
export async function createSession(q: Q, { now = Date.now(), client = "unknown" }: { now?: number; client?: string } = {}) {
  const e = epoch();
  if (!e) throw new Error("no usable admin token");
  const id = randomBytes(8).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  await q.run("INSERT INTO operator_sessions (id, secret_hash, epoch, created_at, expires_at, client) VALUES (?, ?, ?, ?, ?, ?)", id, sha(secret).toString("hex"), e, Math.round(now), Math.round(now + SESSION_TTL), client);
  if (Math.random() < 0.05) await q.run("DELETE FROM operator_sessions WHERE expires_at < ?", Math.round(now - 30 * 86_400_000)); // long-dead rows only
  return { id, value: `${id}.${secret}`, expiresAt: now + SESSION_TTL };
}

/** The id of the live session this request carries, or undefined. Refuses everything else, and notes a revoked or expired session being presented again. */
export async function activeSession(q: Q, req: Request, now = Date.now()): Promise<string | undefined> {
  const e = epoch();
  const raw = e ? cookie(req, sessionCookieName(req)) : undefined;
  if (!raw) return undefined;
  const [id, secret, ...extra] = raw.split(".");
  if (extra.length || !ID.test(id ?? "") || !SECRET.test(secret ?? "")) return undefined;
  const row = await q.get<SessionRow>("SELECT * FROM operator_sessions WHERE id = ?", id);
  if (!row) return undefined; // an id nobody was issued: nothing to say about it
  const reason = !sameHash(sha(secret), Buffer.from(row.secret_hash, "hex")) ? "wrong_secret"
    : row.revoked_at !== null ? "revoked"
    : Number(row.expires_at) <= now ? "expired"
    : row.epoch !== e ? "admin_token_changed"
    : undefined;
  // A session issued under another admin token is ended for good, so putting the old token back cannot bring it back to life.
  if (reason === "admin_token_changed") await q.run("UPDATE operator_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", Math.round(now), id);
  if (reason) {
    // Once an hour per session and reason, so a browser that keeps sending an old cookie does not fill the log.
    if ((await spend(q, `authlog:rejected:${id}:${reason}`, 1, { windowMs: 3_600_000, now })).ok) await audit(q, "session.rejected", { sessionId: id, reason, now });
    return undefined;
  }
  if (row.last_seen_at === null || Number(row.last_seen_at) < now - TOUCH_EVERY) await q.run("UPDATE operator_sessions SET last_seen_at = ? WHERE id = ? AND revoked_at IS NULL", Math.round(now), id);
  return id;
}

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

/** Ends every session that is still alive, this one included. The answer to "someone else may have my cookie". */
export async function revokeAll(q: Q, by: string, now = Date.now()) {
  const n = await q.run("UPDATE operator_sessions SET revoked_at = ? WHERE revoked_at IS NULL AND expires_at > ?", Math.round(now), Math.round(now));
  await audit(q, "session.revoked_all", { sessionId: by, reason: `${n} ended`, now });
  return n;
}

/** What the operator is shown: live sessions, and the latest authentication events. Nothing secret exists to show. */
export async function sessionOverview(q: Q, current: string, now = Date.now()) {
  const sessions = (await q.all<SessionRow>("SELECT * FROM operator_sessions WHERE revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 50", Math.round(now)))
    .map((s) => ({ id: s.id, createdAt: Number(s.created_at), lastSeenAt: s.last_seen_at === null ? null : Number(s.last_seen_at), expiresAt: Number(s.expires_at), client: s.client, current: s.id === current }));
  const recent = (await q.all<{ at: number; type: AuthEventType; session_id: string | null; client: string | null; reason: string | null }>("SELECT at, type, session_id, client, reason FROM auth_events ORDER BY seq DESC LIMIT 30"))
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
  const operator = await isOperator(q, req);
  return { role: operator ? "operator" : "visitor", canAct: operator, public: config.public, operatorAvailable: !!config.adminToken, demo: config.demo };
}
