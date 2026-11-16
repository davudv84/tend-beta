// Browser notifications (Web Push): Mac, Windows, Android, and iPhone once TEND is on the Home Screen. The protocol is in ../../push.ts.
//
// What a browser notification says: for an approval, the agent's name and the tool and action it asks for, never the detail text or the
// arguments (a lock screen is not a place for them); for everything else fixed text per kind. Always a path on this site: opening it asks
// for a session as always. A low-risk approval carries Approve and Deny buttons; the service worker (public/sw.js) answers them through the
// approval API with the browser's own session. A high-risk one carries none: it can only be opened.
import { DICTS } from "../../../i18n/index.ts";
import { config } from "../../config.ts";
import type { DB } from "../../db.ts";
import { hrefOf, type Kind } from "../../notifications.ts";
import { encrypt, vapidHeader } from "../../push.ts";
import type { Channel, Notice, Tally } from "./types.ts";

interface Sub { id: string; endpoint: string; p256dh: string; auth: string; locale: string; failures: number }
type Result = "sent" | "gone" | "failed";

async function deliver(db: DB, sub: Sub, payload: object, now: number): Promise<Result> {
  let status = 0;
  try {
    const res = await fetch(sub.endpoint, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
      headers: { TTL: "3600", Urgency: "high", "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", Authorization: vapidHeader(sub.endpoint, now) },
      body: encrypt(Buffer.from(JSON.stringify(payload)), sub.p256dh, sub.auth),
    });
    status = res.status;
  } catch {}
  if (status >= 200 && status < 300) {
    await db.run("UPDATE push_subscriptions SET last_sent_at = ?, failures = 0 WHERE id = ?", now, sub.id);
    return "sent";
  }
  // 404 and 410: the browser unsubscribed or the subscription expired. Five failures in a row: stop trying that browser.
  if (status === 404 || status === 410 || sub.failures + 1 >= 5) {
    await db.run("DELETE FROM push_subscriptions WHERE id = ?", sub.id);
    return "gone";
  }
  await db.run("UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ?", sub.id);
  console.error(`[tend] a push service refused a notification (${status || "no answer"})`); // never the endpoint: it identifies the browser
  return "failed";
}

const PREF: Record<Kind, string | null> = { approval: "approval", blocked: "blocked", alert: "alert", failed: "alert", expired: null, test: null };

/** The browsers of this workspace's accounts that want this kind. A test goes to every subscribed browser of the workspace. */
async function targets(db: DB, workspace: string, kind: Kind) {
  const pref = PREF[kind];
  return db.all<Sub>(
    `SELECT s.id, s.endpoint, s.p256dh, s.auth, s.locale, s.failures FROM push_subscriptions s JOIN users u ON u.id = s.user_id
     LEFT JOIN notification_prefs p ON p.user_id = u.id
     WHERE u.workspace_id = ? AND u.disabled_at IS NULL ${pref ? `AND COALESCE(p.${pref}, 1) = 1` : ""}`, workspace);
}

const dict = (locale: string) => DICTS[locale === "de" ? "de" : "en"].notify;
const short = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** What the service worker receives for an approval. Everything in it may appear on a lock screen. */
function approvalPayload(locale: string, a: NonNullable<Notice["approval"]>) {
  const t = dict(locale).pushApproval;
  return {
    type: "approval", title: t.title, body: t.body(short(a.agentName, 60), a.tool, a.action), tag: a.id, url: a.url, approvalId: a.id, risk: a.risk,
    // One-tap answers only where the server would accept them. The server checks again whatever the notification offered.
    actions: a.risk === "low" ? [{ action: "approve", title: t.approve }, { action: "deny", title: t.deny }] : [],
    text: t.done,
  };
}

async function sendAll(db: DB, subs: Sub[], payload: (locale: string) => object, now: number): Promise<Tally> {
  const results = await Promise.all(subs.map((sub) => deliver(db, sub, payload(sub.locale), now).catch((): Result => "failed")));
  const sent = results.filter((r) => r === "sent").length;
  return { sent, failed: results.length - sent };
}

export const webPush: Channel = {
  name: "web-push",
  configured: () => !!config.vapid,
  carries: (kind) => kind !== "expired",
  async send(db, n, now) {
    const subs = await targets(db, n.workspace, n.kind);
    const a = n.kind === "approval" ? n.approval : undefined;
    const tally = await sendAll(db, subs, (locale) => {
      if (a) return approvalPayload(locale, a);
      const text = dict(locale).push[n.kind];
      return { type: n.kind, title: text.title, body: text.body, url: hrefOf(n.kind, n.subject, n.agentId), tag: n.id };
    }, now);
    // Remembered so the notification can be replaced once the approval is settled; one row for all of the workspace's browsers.
    if (a && tally.sent) await db.run("INSERT INTO delivery_messages (notification_id, channel, target, message_id, created_at) VALUES (?, 'web-push', 'all', ?, ?) ON CONFLICT DO NOTHING", n.id, a.id, now);
    return tally;
  },
  async resolved(db, n, now) {
    // Claimed by deleting: of any number of callers, one sends the replacement.
    if (!(await db.run("DELETE FROM delivery_messages WHERE notification_id = ? AND channel = 'web-push'", n.id))) return;
    const a = n.approval;
    if (a.status === "pending") return;
    // Same tag as the request, so the browser replaces the waiting notification (and its buttons) with what became of it.
    await sendAll(db, await targets(db, n.workspace, "approval"), (locale) => {
      const t = dict(locale).pushApproval, what = `${short(a.agentName, 60)}: ${a.tool} · ${a.action}`;
      const line = a.status === "approved" || a.status === "denied" ? t.resolved[a.status](a.decidedBy ?? t.someone, t.via[a.via ?? "dashboard"]) : t.resolved[a.status as "expired" | "cancelled"];
      return { type: "resolved", title: t.resolvedTitle[a.status as "approved" | "denied" | "expired" | "cancelled"], body: `${what}\n${line}`, tag: a.id, url: a.url };
    }, now);
  },
};
