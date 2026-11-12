// What the Activity screen says about each event, decided in one pure place so it can be tested without a browser.
//
// Every row gets at most one outcome word. The word is only ever taken from what Tend recorded for that event: it never
// infers a result from a different event, and an event with no clear outcome gets none.
import type { TimelineEvent } from "./derive.ts";
import type { Agent } from "./types";

export type Outcome = "needs_approval" | "approved" | "rejected" | "allowed" | "ran" | "failed" | "blocked" | "expired" | "withdrawn" | "alert" | "change" | "review";

/** The groups people filter by. "all" shows everything. */
export type Group = "all" | "approvals" | "allowed" | "blocked" | "alerts" | "changes";
export const GROUPS: Group[] = ["all", "approvals", "allowed", "blocked", "alerts", "changes"];

export function outcomeOf(e: TimelineEvent): Outcome | null {
  if (e.say.k === "task") {
    if (e.say.type !== "tool.called") return e.say.type === "task.failed" ? "failed" : null;
    switch (e.outcome) {
      case "success": return "ran";
      case "failure": return "failed";
      case "denied": return "blocked";
      case "pending_approval": return "needs_approval";
      case "cancelled": return "withdrawn";
      default: return null;
    }
  }
  if (e.say.k !== "log") return e.kind === "review" || e.kind === "context" || e.kind === "conflict" ? "review" : null;
  switch (e.say.type) {
    case "authorization_requested": return e.say.args?.reason === "approval_required" ? "needs_approval" : e.say.args?.reason === "policy_allowed" ? "allowed" : null;
    case "authorization_approved": case "review_approved": case "permission_granted": return "approved";
    case "authorization_rejected": case "review_rejected": return "rejected";
    case "authorization_denied": return "blocked";
    case "authorization_consumed": return "ran";
    case "authorization_expired": return "expired";
    case "authorization_cancelled": case "review_withdrawn": return "withdrawn";
    case "authorization_replay": case "authorization_mismatch": case "unauthorized_execution": case "unapproved_execution": case "policy_violation": case "repeated_failures": return "alert";
    case "review_acknowledged": return "review";
    default: return "change";
  }
}

export const IN_GROUP: Record<Exclude<Group, "all">, Outcome[]> = {
  approvals: ["needs_approval", "approved", "rejected", "expired", "withdrawn", "review"],
  allowed: ["allowed", "ran"],
  blocked: ["blocked", "rejected"],
  alerts: ["alert", "failed"],
  changes: ["change"],
};

export function inGroup(e: TimelineEvent, group: Group) {
  if (group === "all") return true;
  const o = outcomeOf(e);
  return !!o && IN_GROUP[group].includes(o);
}

/** Events of real assistants only, unless the person asks for the invented samples too (the same rule as Home). */
export const visibleAgent = (agents: Pick<Agent, "id" | "origin">[], includeSamples: boolean) => {
  const ids = new Set(agents.filter((a) => includeSamples || a.origin === "connected").map((a) => a.id));
  return (e: { agentId: string }) => ids.has(e.agentId);
};

/** A row on Activity: the newest event of an action, with every step that action went through (oldest first). */
export type ActionRow = TimelineEvent & { steps: TimelineEvent[] };

/**
 * One row per action. Events that are steps of the same authorization (asked, decided, ran, reported after it ran) fold into one row: its
 * newest event, which says how the action ended, carrying the earlier steps. Events without an authorization stay rows of their own.
 * `events` is newest first, as timeline() returns it.
 */
export function byAction(events: TimelineEvent[]): ActionRow[] {
  const rows: ActionRow[] = [];
  const at = new Map<string, ActionRow>();
  for (const e of events) {
    const row = e.authorizationId ? at.get(e.authorizationId) : undefined;
    if (row) { row.steps.unshift(e); continue; }
    const fresh = { ...e, steps: [e] };
    rows.push(fresh);
    if (e.authorizationId) at.set(e.authorizationId, fresh);
  }
  return rows;
}

/** The path an action took, in order and without repeats: ["allowed", "ran"], ["needs_approval", "approved", "ran"]. */
export function trailOf(row: ActionRow): Outcome[] {
  const out: Outcome[] = [];
  for (const s of row.steps) {
    const o = outcomeOf(s);
    if (o && out.at(-1) !== o) out.push(o);
  }
  return out;
}

/** The step that decided the action (a rule or a person), whose reason the row shows; the row itself when no step decided anything. */
export function decidingStep(row: ActionRow): TimelineEvent {
  const decides: Outcome[] = ["blocked", "rejected", "approved", "allowed", "needs_approval"];
  return row.steps.findLast((s) => decides.includes(outcomeOf(s) as Outcome)) ?? row;
}
