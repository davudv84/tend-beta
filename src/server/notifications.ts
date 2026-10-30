// Notifications: the few things a person should look at, worked out from events as they are written. They are created in the same
// transaction as the event (insertEvent calls notifyFor), so a notification exists exactly when its event does, and a rolled-back request
// leaves neither. Only connected agents notify; demo agents never do.
//
// Rules this file keeps:
//  - Every read and change is bounded by the caller's workspace; an id from another workspace is simply not there.
//  - One row per workspace and dedup key. A repeated event (the same action blocked again and again) raises the count and moves the row
//    to the top; it never adds a row and never sends a second browser notification.
//  - A notification carries ids and kinds, never an event's content: the app shows the agent and tool, a browser notification shows
//    neither (see push.ts).
//  - An approval notification is a pointer to the Approvals page. Deciding still needs a session and goes through the normal review route.
import { createHash, randomUUID } from "node:crypto";
import type { WireEvent } from "../lib/projection.ts";
import { config } from "./config.ts";
import type { Q } from "./db.ts";
import { HttpError } from "./http.ts";
import { markPushDue } from "./push-due.ts";

export type Kind = "approval" | "blocked" | "alert" | "failed" | "expired" | "test";
/** Kinds a browser notification is sent for (if the person turned it on). The rest are listed in the app only. */
const PUSHED = new Set<Kind>(["approval", "blocked", "alert", "failed", "test"]);
/** Blocks of the same tool and action by the same agent within this window are one notification. */
export const BLOCKED_WINDOW = 10 * 60_000;
export const MAX_SUBSCRIPTIONS = 10;

const ms = (t: number) => Math.round(t);
const S = (v: unknown) => (typeof v === "string" ? v : undefined);

/** What an event means for the person, if anything: a new (or repeated) notification, or an approval that no longer waits. */
function classify(e: WireEvent): { kind: Kind; subject?: string; key: string } | { resolve: string } | undefined {
  const d = e.data;
  switch (e.type) {
    case "authorization.requested":
      return d.approval === true && S(d.authorizationId) ? { kind: "approval", subject: S(d.authorizationId), key: `approval:${d.authorizationId}` } : undefined;
    case "authorization.denied":
      return { kind: "blocked", subject: S(d.authorizationId), key: `blocked:${e.agentId}:${S(d.tool)}:${S(d.action)}:${Math.floor(e.at / BLOCKED_WINDOW)}` };
    case "alert.raised":
      return { kind: "alert", subject: S(d.authorizationId), key: `alert:${S(d.kind)}:${S(d.authorizationId) ?? e.agentId}` };
    case "tool.called":
      // Only TEND's own record of a gateway run counts; an agent cannot report on TEND's behalf.
      return e.actor === "system" && d.via === "gateway" && d.outcome === "failure" && S(d.authorizationId) ? { kind: "failed", subject: S(d.authorizationId), key: `failed:${d.authorizationId}` } : undefined;
    case "review.withdrawn":
      return d.reason === "expired" && S(d.reviewId) ? { kind: "expired", subject: S(d.reviewId), key: `expired:${d.reviewId}` } : undefined;
    case "review.decided":
      return S(d.authorizationId) ? { resolve: S(d.authorizationId)! } : undefined;
    case "authorization.cancelled":
    case "authorization.expired":
      return S(d.authorizationId) ? { resolve: S(d.authorizationId)! } : undefined;
    default:
      return undefined;
  }
}

async function anySubscriber(q: Q, workspace: string) {
  return !!config.vapid && !!(await q.get("SELECT 1 FROM push_subscriptions s JOIN users u ON u.id = s.user_id WHERE u.workspace_id = ? LIMIT 1", workspace));
}

async function upsert(q: Q, workspace: string, kind: Kind, key: string, at: number, agentId: string | null, subject: string | null) {
  const push = PUSHED.has(kind) && (await anySubscriber(q, workspace)) ? "queued" : "none";
  // A repeat moves the row up and makes it unread again, but keeps its push state: one browser notification per row, ever.
  const r = await q.get<{ inserted: boolean }>(
    `INSERT INTO notifications (id, workspace_id, kind, agent_id, subject, dedup_key, created_at, updated_at, push) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (workspace_id, dedup_key) DO UPDATE SET count = notifications.count + 1, updated_at = EXCLUDED.updated_at, read_at = NULL
     RETURNING (xmax = 0) AS inserted`,
    `nt_${randomUUID().replaceAll("-", "").slice(0, 20)}`, workspace, kind, agentId, subject, key, ms(at), ms(at), push);
  if (r?.inserted && push === "queued") markPushDue();
  return !!r?.inserted;
}

/** Called by insertEvent for every event, inside its transaction. Cheap for the events that mean nothing here. */
export async function notifyFor(q: Q, e: WireEvent) {
  const c = classify(e);
  if (!c) return;
  if ("resolve" in c) {
    await q.run("UPDATE notifications SET resolved_at = ?, read_at = COALESCE(read_at, ?) WHERE dedup_key = ? AND resolved_at IS NULL", ms(e.at), ms(e.at), `approval:${c.resolve}`);
    return;
  }
  const agent = await q.get<{ workspace_id: string }>("SELECT workspace_id FROM agents WHERE id = ? AND origin = 'connected'", e.agentId);
  if (!agent) return;
  await upsert(q, agent.workspace_id, c.kind, c.key, e.at, e.agentId, c.subject ?? null);
}

/** A test notification for this workspace (Settings, the setup guide). Sent to the browser too when push is set up and turned on. */
export async function createTestNotification(q: Q, workspace: string, now = Date.now()) {
  await upsert(q, workspace, "test", `test:${ms(now)}:${randomUUID().slice(0, 8)}`, now, null, null);
}

// ---- reading -------------------------------------------------------------------------------------

interface Row {
  id: string; kind: Kind; agent_id: string | null; subject: string | null; count: number; created_at: number; updated_at: number;
  read_at: number | null; resolved_at: number | null; profile: string | null; tool: string | null; action: string | null; auth_status: string | null;
}

/** Where a notification leads. Always a path on this site; the page it opens asks for a session like any other. */
export function hrefOf(kind: Kind, subject: string | null, agentId: string | null) {
  if ((kind === "approval" || kind === "expired") && subject) return `/oversight?request=${encodeURIComponent(subject)}`;
  if ((kind === "alert" || kind === "failed") && agentId) return `/agents/${encodeURIComponent(agentId)}`;
  if (kind === "test") return "/settings?tab=notifications";
  return "/timeline";
}

export async function listNotifications(q: Q, workspace: string, limit = 50) {
  const rows = await q.all<Row>(
    `SELECT n.id, n.kind, n.agent_id, n.subject, n.count, n.created_at, n.updated_at, n.read_at, n.resolved_at, a.profile, z.tool, z.action, z.status AS auth_status
     FROM notifications n LEFT JOIN agents a ON a.id = n.agent_id LEFT JOIN authorizations z ON z.id = n.subject
     WHERE n.workspace_id = ? ORDER BY n.updated_at DESC LIMIT ?`, workspace, limit);
  const unread = (await q.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM notifications WHERE workspace_id = ? AND read_at IS NULL", workspace))!.n;
  return {
    unread,
    items: rows.map((r) => ({
      id: r.id, kind: r.kind, agentId: r.agent_id, agentName: r.profile ? (JSON.parse(r.profile) as { name: string }).name : null,
      tool: r.tool, action: r.action, status: r.auth_status, count: r.count, createdAt: r.created_at, updatedAt: r.updated_at,
      read: r.read_at !== null, resolved: r.resolved_at !== null, href: hrefOf(r.kind, r.subject, r.agent_id),
    })),
  };
}

/** Marks some (or all) of this workspace's notifications read. Ids from elsewhere match nothing. */
export async function markRead(q: Q, workspace: string, body: unknown, now = Date.now()) {
  const o = (body && typeof body === "object" ? body : {}) as { ids?: unknown; all?: unknown };
  if (o.all === true) return q.run("UPDATE notifications SET read_at = ? WHERE workspace_id = ? AND read_at IS NULL", ms(now), workspace);
  if (!Array.isArray(o.ids) || o.ids.length === 0 || o.ids.length > 100 || !o.ids.every((x) => typeof x === "string" && /^nt_[a-f0-9]{20}$/.test(x)))
    throw new HttpError(422, "invalid_request", "Send { ids: [...] } (1–100 notification ids) or { all: true }.");
  return q.run(`UPDATE notifications SET read_at = ? WHERE workspace_id = ? AND read_at IS NULL AND id IN (${o.ids.map(() => "?").join(", ")})`, ms(now), workspace, ...o.ids);
}

// ---- preferences and browser subscriptions (accounts only) -------------------------------------------

export type Prefs = { approval: boolean; blocked: boolean; alert: boolean };
const PREF_KEYS = ["approval", "blocked", "alert"] as const;

function needAccount(userId: string | null): asserts userId is string {
  if (!userId) throw new HttpError(409, "account_required", "Notification preferences belong to an account. Sign in with your e-mail address.");
}

export async function getPrefs(q: Q, userId: string | null): Promise<Prefs> {
  needAccount(userId);
  const r = await q.get<Record<(typeof PREF_KEYS)[number], number>>("SELECT approval, blocked, alert FROM notification_prefs WHERE user_id = ?", userId);
  return { approval: r ? !!r.approval : true, blocked: r ? !!r.blocked : true, alert: r ? !!r.alert : true };
}

export async function setPrefs(q: Q, userId: string | null, body: unknown, now = Date.now()) {
  needAccount(userId);
  const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const keys = Object.keys(o);
  if (!keys.length || keys.some((k) => !(PREF_KEYS as readonly string[]).includes(k) || typeof o[k] !== "boolean"))
    throw new HttpError(422, "invalid_request", "Send any of approval, blocked, alert as true or false.");
  const p = { ...(await getPrefs(q, userId)), ...(o as Partial<Prefs>) };
  await q.run(`INSERT INTO notification_prefs (user_id, approval, blocked, alert, updated_at) VALUES (?, ?, ?, ?, ?)
               ON CONFLICT (user_id) DO UPDATE SET approval = EXCLUDED.approval, blocked = EXCLUDED.blocked, alert = EXCLUDED.alert, updated_at = EXCLUDED.updated_at`,
    userId, p.approval ? 1 : 0, p.blocked ? 1 : 0, p.alert ? 1 : 0, ms(now));
  return p;
}

// Known push services only. An endpoint is a URL the server will POST to, so anything else (an internal address, a metadata service) is
// refused before it is stored. Loopback is allowed only for local tests, never on Vercel.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/];
export function pushEndpointOk(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > 1024) return false;
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.username || u.password || u.hash) return false;
  if (process.env.TEND_PUSH_TEST_ENDPOINTS === "loopback" && !config.onVercel && u.protocol === "http:" && u.hostname === "127.0.0.1") return true;
  return u.protocol === "https:" && (u.port === "" || u.port === "443") && PUSH_HOSTS.some((h) => h.test(u.hostname));
}

const B64URL = /^[A-Za-z0-9_-]+$/;
const endpointHash = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex");

export async function saveSubscription(q: Q, userId: string | null, body: unknown, now = Date.now()) {
  needAccount(userId);
  if (!config.vapid) throw new HttpError(503, "push_not_configured", "Browser notifications are not set up on this TEND server.");
  const o = (body && typeof body === "object" ? body : {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown }; locale?: unknown };
  const p256dh = o.keys?.p256dh, auth = o.keys?.auth;
  const keyOk = (v: unknown, bytes: number) => typeof v === "string" && B64URL.test(v) && Buffer.from(v, "base64url").length === bytes;
  if (!pushEndpointOk(o.endpoint)) throw new HttpError(422, "invalid_subscription", "That is not a browser push service this server delivers to.");
  if (!keyOk(p256dh, 65) || Buffer.from(p256dh as string, "base64url")[0] !== 4 || !keyOk(auth, 16)) throw new HttpError(422, "invalid_subscription", "The subscription keys are malformed.");
  const locale = o.locale === "de" ? "de" : "en";
  const hash = endpointHash(o.endpoint);
  const existing = await q.get<{ user_id: string }>("SELECT user_id FROM push_subscriptions WHERE endpoint_hash = ?", hash);
  // A browser endpoint belongs to whoever subscribed it last on that browser; the previous account stops receiving there.
  if (existing) {
    await q.run("UPDATE push_subscriptions SET user_id = ?, p256dh = ?, auth = ?, locale = ?, failures = 0 WHERE endpoint_hash = ?", userId, p256dh, auth, locale, hash);
    return;
  }
  if ((await q.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM push_subscriptions WHERE user_id = ?", userId))!.n >= MAX_SUBSCRIPTIONS)
    throw new HttpError(409, "too_many_subscriptions", `At most ${MAX_SUBSCRIPTIONS} browsers can receive notifications for one account. Turn one off first.`);
  await q.run("INSERT INTO push_subscriptions (id, user_id, endpoint_hash, endpoint, p256dh, auth, locale, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    `ps_${randomUUID().replaceAll("-", "").slice(0, 20)}`, userId, hash, o.endpoint, p256dh, auth, locale, ms(now));
}

/** Turns notifications off for one browser. Only the account that owns the subscription can remove it; anything else is a no-op. */
export async function removeSubscription(q: Q, userId: string | null, body: unknown) {
  needAccount(userId);
  const endpoint = (body && typeof body === "object" ? (body as { endpoint?: unknown }).endpoint : undefined);
  if (typeof endpoint !== "string" || endpoint.length > 1024) throw new HttpError(422, "invalid_request", "Send { endpoint }.");
  return q.run("DELETE FROM push_subscriptions WHERE endpoint_hash = ? AND user_id = ?", endpointHash(endpoint), userId);
}

/** How many browsers receive this account's notifications, and whether this server can send any. Endpoints are never sent back. */
export async function pushStatus(q: Q, userId: string | null) {
  const n = userId ? (await q.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM push_subscriptions WHERE user_id = ?", userId))!.n : 0;
  return { configured: !!config.vapid, publicKey: config.vapid?.publicKey ?? null, subscriptions: n, account: !!userId };
}

/** Whether this browser's endpoint is one of the account's subscriptions (the endpoint is hashed, never stored by the client). */
export async function hasSubscription(q: Q, userId: string | null, endpoint: unknown) {
  if (!userId || typeof endpoint !== "string") return false;
  return !!(await q.get("SELECT 1 FROM push_subscriptions WHERE endpoint_hash = ? AND user_id = ?", endpointHash(endpoint), userId));
}
