// Approvals: the one place a person's decision on a waiting request is made, whatever it came through. The dashboard, a browser
// notification's button, a Telegram button and (later) a native app all end in resolveApproval, so the rules below hold for every one of them.
//
// An approval is an authorization that waits for a person (authz.ts): the same row, the same id. Nothing here changes what an agent sees or
// how it waits; an agent still reads the authorization's status and still gets "expired" when nobody answered.
//
// Rules this file keeps:
//  - Only someone acting for the approval's own workspace can read or decide it. An id from elsewhere is "not found", like one that never existed.
//  - An approval is decided once. The first decision wins (one UPDATE ... WHERE status = 'pending', under the event lock); every later call,
//    simultaneous or not, is answered with what was decided and changes nothing.
//  - Expired means not approved. It is checked when a decision arrives and whenever anything reads the status.
//  - A high-risk approval cannot be approved from a notification (Web Push, Telegram): only on TEND's approval page, signed in. A notification
//    may still deny it, which is always the safe answer. The risk was fixed by the server when the agent asked, from the rule that decided it.
//  - Every decision is in the event log with who, when, what, the channel and the approval id (review.decided: by, userId, via, authorizationId).
import { expireStale, sweepExpired } from "./authz.ts";
import type { DB, Q } from "./db.ts";
import { HttpError } from "./http.ts";
import type { WireEvent } from "../lib/projection.ts";
import type { RiskLevel } from "./policy.ts";
import { decideIn } from "./repo.ts";

export const VIAS = ["dashboard", "web-push", "telegram"] as const;
export type Via = (typeof VIAS)[number];
export const DECISIONS = ["approve", "deny"] as const;
export type Decision = (typeof DECISIONS)[number];
export const APPROVAL_ID = /^az_[a-f0-9]{24}$/;

/** Who decides. `by` is recorded beside the decision (a session id, or "telegram:<their Telegram id>"); `workspace` bounds what they may touch. */
export interface Actor { workspace: string; userId: string | null; by: string }

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired" | "cancelled";
export interface ApprovalView {
  id: string; agentId: string; agentName: string; tool: string; action: string; resource: string | null; detail: string | null;
  risk: RiskLevel; status: ApprovalStatus;
  /** What it came to: expired counts as deny; null while it waits, or when the agent withdrew it. */
  decision: Decision | null;
  createdAt: number; expiresAt: number; decidedAt: number | null;
  /** The account that decided (its e-mail address), "admin" for the admin-token operator, null when nobody did. */
  decidedBy: string | null;
  via: Via | null;
  /** Where a person confirms or looks at it: a path on this site. */
  url: string;
}

interface Row {
  id: string; agent_id: string; tool: string; action: string; resource: string | null; detail: string | null; status: string; risk: RiskLevel;
  created_at: number; expires_at: number; decided_at: number | null; workspace_id: string; profile: string;
}

export const approvalPath = (id: string) => `/approvals/${id}`;
const notFound = () => new HttpError(404, "approval_not_found", "No approval with that id.");

const STATUS: Record<string, ApprovalStatus> = { pending: "pending", approved: "approved", consumed: "approved", rejected: "denied", denied: "denied", expired: "expired", cancelled: "cancelled" };
const DECIDED: Record<ApprovalStatus, Decision | null> = { pending: null, approved: "approve", denied: "deny", expired: "deny", cancelled: null };

// Only requests a person was asked about: an authorization the policy allowed or refused on its own has no review and is not an approval.
const SELECT = `SELECT z.id, z.agent_id, z.tool, z.action, z.resource, z.detail, z.status, z.risk, z.created_at, z.expires_at, z.decided_at, a.workspace_id, a.profile
  FROM authorizations z JOIN agents a ON a.id = z.agent_id WHERE EXISTS (SELECT 1 FROM reviews r WHERE r.id = z.id)`;

async function view(q: Q, r: Row): Promise<ApprovalView> {
  const status = STATUS[r.status] ?? "denied";
  let decidedBy: string | null = null, via: Via | null = null;
  if (status === "approved" || status === "denied") {
    const e = await q.get<{ data: string }>("SELECT data FROM events WHERE agent_id = ? AND type = 'review.decided' AND (data::jsonb)->>'reviewId' = ? ORDER BY seq DESC LIMIT 1", r.agent_id, r.id);
    const d = e ? (JSON.parse(e.data) as { userId?: string; via?: string }) : undefined;
    if (d) {
      // Decisions recorded before channels existed were all made in the dashboard.
      via = (VIAS as readonly string[]).includes(d.via ?? "") ? (d.via as Via) : "dashboard";
      decidedBy = d.userId ? (await q.get<{ email: string }>("SELECT email FROM users WHERE id = ?", d.userId))?.email ?? "a removed account" : "admin";
    }
  }
  return {
    id: r.id, agentId: r.agent_id, agentName: (JSON.parse(r.profile) as { name: string }).name, tool: r.tool, action: r.action, resource: r.resource, detail: r.detail,
    risk: r.risk, status, decision: DECIDED[status], createdAt: r.created_at, expiresAt: r.expires_at, decidedAt: status === "pending" || status === "cancelled" || status === "expired" ? null : r.decided_at,
    decidedBy, via, url: approvalPath(r.id),
  };
}

/** What waits for a person in this workspace, soonest to expire first. */
export async function listPendingApprovals(db: DB, workspace: string, now = Date.now()): Promise<ApprovalView[]> {
  await sweepExpired(db, now);
  const rows = await db.all<Row>(`${SELECT} AND a.workspace_id = ? AND z.status = 'pending' ORDER BY z.expires_at, z.id LIMIT 200`, workspace);
  return Promise.all(rows.map((r) => view(db, r)));
}

/** One approval of this workspace, whatever became of it. Anything past its time is expired by the time it is read. */
export async function getApproval(db: DB, workspace: string, id: string, now = Date.now()): Promise<ApprovalView> {
  if (!APPROVAL_ID.test(id)) throw notFound();
  await sweepExpired(db, now);
  const row = await db.get<Row>(`${SELECT} AND z.id = ?`, id);
  if (!row || row.workspace_id !== workspace) throw notFound();
  return view(db, row);
}

/** The same, for code that already knows the approval exists and where (the notifier). No workspace check: never call it with an id a client sent. */
export async function approvalForDelivery(q: Q, id: string): Promise<(ApprovalView & { workspace: string }) | undefined> {
  const row = await q.get<Row>(`${SELECT} AND z.id = ?`, id);
  return row ? { ...(await view(q, row)), workspace: row.workspace_id } : undefined;
}

export interface Resolution {
  approval: ApprovalView;
  /** True only for the call that made the decision. False: it was already decided (or expired, or withdrawn) and nothing changed. */
  changed: boolean;
  /** The events the decision wrote (empty when nothing changed). */
  events: WireEvent[];
}

/**
 * Records a person's decision on an approval. See the rules at the top of this file; all of them are enforced here, on the server, for every
 * channel. Throws 404 for an approval the actor's workspace does not have, 403 `confirmation_required` for approving a high-risk one from a
 * notification, 403 `not_a_member` for an account that may no longer act. A repeat or a lost race is not an error: it returns what stands.
 */
export async function resolveApproval(db: DB, input: { id: string; decision: unknown; via: unknown; actor: Actor; note?: string }, now = Date.now()): Promise<Resolution> {
  const { id, actor } = input;
  if (!(DECISIONS as readonly unknown[]).includes(input.decision)) throw new HttpError(422, "invalid_decision", "decision must be approve or deny.");
  if (!(VIAS as readonly unknown[]).includes(input.via)) throw new HttpError(422, "invalid_via", `via must be one of ${VIAS.join(", ")}.`);
  const decision = input.decision as Decision, via = input.via as Via;
  if (!APPROVAL_ID.test(id)) throw notFound();
  // Committed on its own, so an expiry stays recorded even if the decision below is refused and rolled back.
  await sweepExpired(db, now);
  return db.tx(async (q) => {
    await q.lockEvents();
    await expireStale(q, now);
    const row = await q.get<Row>(`${SELECT} AND z.id = ? FOR UPDATE OF z`, id);
    if (!row || row.workspace_id !== actor.workspace) throw notFound();
    // Whoever the caller says it is, the account must (still) belong to this workspace and be allowed to change things.
    if (actor.userId !== null && !(await q.get("SELECT 1 FROM users WHERE id = ? AND workspace_id = ? AND disabled_at IS NULL AND read_only = 0", actor.userId, row.workspace_id)))
      throw new HttpError(403, "not_a_member", "This account cannot decide approvals in this workspace.");
    // Already decided, expired or withdrawn: the first outcome stands and this call changes nothing.
    if (row.status !== "pending") return { approval: await view(q, row), changed: false, events: [] };
    if (decision === "approve" && row.risk !== "low" && via !== "dashboard")
      throw new HttpError(403, "confirmation_required", "This approval is high risk: open it in TEND and confirm it there.", { risk: row.risk, url: approvalPath(id) });
    const events = await decideIn(q, id, decision === "approve" ? "approved" : "rejected", input.note, actor.by, now, { via, ...(actor.userId && { userId: actor.userId }) });
    return { approval: await view(q, (await q.get<Row>(`${SELECT} AND z.id = ?`, id))!), changed: true, events };
  });
}
