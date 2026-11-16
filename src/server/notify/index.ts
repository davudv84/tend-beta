// The notifier: everything that tells a person outside the app that something needs them. One queue (the notifications table, filled in the
// same transaction as the event that caused it), any number of channels (./channels, one file each), and one rule for all of them: a channel
// that fails or is slow never holds up another, and never the agent's answer (delivery runs after the response, see http.ts).
//
//   notifyApproval   a new approval goes to every channel the workspace's people connected, in parallel
//   notifyResolved   once it is decided, expired or withdrawn, what each channel put out is updated ("✅ Approved by ana@… via Telegram")
//   flushNotifications   sends what is queued, each notification claimed once so two instances never send it twice
import { approvalForDelivery } from "../approvals.ts";
import type { DB } from "../db.ts";
import type { Kind } from "../notifications.ts";
import { telegram } from "./channels/telegram.ts";
import type { Channel, ChannelName, Notice, Tally } from "./channels/types.ts";
import { webPush } from "./channels/web-push.ts";

/** Every channel TEND can notify through. A new one (Slack, a native app) is added here and nowhere else. */
export const CHANNELS: Channel[] = [webPush, telegram];
const live = (kind: Kind) => CHANNELS.filter((c) => c.configured() && c.carries(kind));
export const anyChannelConfigured = () => CHANNELS.some((c) => c.configured());

/** Only queued notifications this young are sent: a notification about an approval that already lapsed is noise. */
export const PUSH_MAX_AGE = 15 * 60_000;

type Tallies = Partial<Record<ChannelName, Tally>>;

/** One notice to every channel that carries its kind, all at once. A channel that throws counts as one failure and stops nothing. */
async function fanOut(db: DB, notice: Notice, now: number): Promise<Tallies> {
  const channels = live(notice.kind);
  const settled = await Promise.allSettled(channels.map((c) => c.send(db, notice, now)));
  const out: Tallies = {};
  settled.forEach((s, i) => {
    if (s.status === "rejected") console.error(`[tend] the ${channels[i].name} channel failed:`, (s.reason as Error)?.message);
    out[channels[i].name] = s.status === "fulfilled" ? s.value : { sent: 0, failed: 1 };
  });
  return out;
}

/**
 * A new approval reaches people: every connected channel of its workspace, in parallel. Called for each approval as it is created (through
 * the queue: the notice is written with the request, this runs right after the agent got its answer).
 */
export async function notifyApproval(db: DB, notice: Notice, now = Date.now()): Promise<Tallies> {
  if (!notice.approval || notice.approval.status !== "pending") return {};
  const out = await fanOut(db, notice, now);
  // Decided while the messages were on their way: what was just sent is brought up to date at once.
  const after = await approvalForDelivery(db, notice.approval.id);
  if (after && after.status !== "pending") await notifyResolved(db, after.id, now);
  return out;
}

/** An approval was decided, expired or withdrawn: every channel updates what it sent for it. Safe to call more than once. */
export async function notifyResolved(db: DB, approvalId: string, now = Date.now()) {
  const approval = await approvalForDelivery(db, approvalId);
  if (!approval || approval.status === "pending") return;
  const n = await db.get<{ id: string; agent_id: string | null; created_at: number }>("SELECT id, agent_id, created_at FROM notifications WHERE workspace_id = ? AND dedup_key = ?", approval.workspace, `approval:${approvalId}`);
  if (!n) return;
  const notice = { id: n.id, workspace: approval.workspace, kind: "approval" as const, subject: approvalId, agentId: n.agent_id, createdAt: n.created_at, approval };
  const channels = CHANNELS.filter((c) => c.configured());
  (await Promise.allSettled(channels.map((c) => c.resolved(db, notice, now)))).forEach((s, i) => {
    if (s.status === "rejected") console.error(`[tend] the ${channels[i].name} channel could not update a message:`, (s.reason as Error)?.message);
  });
}

/**
 * Sends what is queued. Each notification is claimed by one atomic update before anything is sent, so two instances (or two requests)
 * never send the same one twice. One that cannot be delivered is not retried: the app still lists it.
 * `configured`, `sent` and `failed` are about browsers (what Settings reports); `channels` has every channel's numbers.
 */
export async function flushNotifications(db: DB, now = Date.now()) {
  const configured = webPush.configured();
  if (!anyChannelConfigured()) {
    await db.run("UPDATE notifications SET push = 'skipped' WHERE push = 'queued'");
    return { configured, sent: 0, failed: 0, channels: {} as Tallies };
  }
  const claimed = await db.all<{ id: string; workspace_id: string; kind: Kind; subject: string | null; agent_id: string | null; created_at: number }>(
    `UPDATE notifications SET push = 'sending' WHERE id IN (SELECT id FROM notifications WHERE push = 'queued' ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED)
     RETURNING id, workspace_id, kind, subject, agent_id, created_at`);
  const total: Tallies = {};
  for (const n of claimed) {
    let out: Tallies = {};
    if (n.created_at > now - PUSH_MAX_AGE) {
      const notice: Notice = { id: n.id, workspace: n.workspace_id, kind: n.kind, subject: n.subject, agentId: n.agent_id, createdAt: n.created_at };
      if (n.kind === "approval") {
        const approval = n.subject ? await approvalForDelivery(db, n.subject) : undefined;
        if (approval && approval.workspace === n.workspace_id) out = await notifyApproval(db, { ...notice, approval }, now);
      } else out = await fanOut(db, notice, now);
    }
    for (const [name, t] of Object.entries(out) as [ChannelName, Tally][]) total[name] = { sent: (total[name]?.sent ?? 0) + t.sent, failed: (total[name]?.failed ?? 0) + t.failed };
    await db.run("UPDATE notifications SET push = ? WHERE id = ?", Object.values(out).some((t) => t.sent > 0) ? "sent" : "skipped", n.id);
  }
  return { configured, sent: total["web-push"]?.sent ?? 0, failed: total["web-push"]?.failed ?? 0, channels: total };
}
