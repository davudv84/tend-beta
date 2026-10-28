// What a viewer may see of an event. Operators see everything. Everyone else (visitors of a public instance, who can read the
// events of demo agents and of connected agents an operator marked public) sees activity, never contents:
//
//  - Demo agents are invented, so their seeded sample text stays: that is the public demonstration. What an operator does to
//    one live (a comment on a decision, a pause note, a check-in composed by hand) is the operator's own text, not sample text,
//    so it gets the same treatment as a connected agent's. Live operator actions are the ones that carry the session id `by`
//    (and hand-composed check-ins); seeded events carry neither.
//  - A connected agent that was marked public shows only the SHAPE of what it does: which tool, which action, the outcome, the
//    status of an approval, when, how often. Never what was in the request, an invoice, a customer or note, an operator's
//    comment, an error message, free text an agent wrote, a policy, a key fragment or an operator session id.
//
// It is an allowlist per event type, so a field added to an event later is hidden until someone decides it is safe, and an
// event type that is not listed shows nothing at all (fail closed). Applied in one place, on every path to a non-operator.
import type { WireEvent } from "../lib/projection.ts";
import type { Agent } from "../lib/types";
import type { Viewer } from "./auth.ts";

/** Event types that only operators may know exist. */
const OPERATOR_ONLY = new Set<string>(["verification.run"]);

/**
 * The fields of each event type that are identifiers, enumerated codes, numbers or the agent's own public profile. Identifier
 * fields hold at most 64 characters of letters, digits and _ . : - (the ingestion rules), so they cannot carry a sentence.
 */
const SHAPE: Record<string, readonly string[]> = {
  "agent.registered": ["agent"],
  "agent.idle": [], "agent.disconnected": [],
  "task.started": ["taskId"], "task.completed": ["taskId"], "task.failed": ["taskId"],
  "tool.called": ["tool", "action", "outcome", "taskId", "policy", "approval", "approvalId", "authorizationId", "via", "permission"],
  "authorization.requested": ["authorizationId", "tool", "action", "status", "reason", "approval", "expiresAt"],
  "authorization.denied": ["authorizationId", "tool", "action", "reason"],
  "authorization.consumed": ["authorizationId", "tool", "action"],
  "authorization.expired": ["authorizationId"], "authorization.cancelled": ["authorizationId"],
  "review.requested": [], "review.withdrawn": ["reviewId"],
  "review.decided": ["reviewId", "status", "authorizationId", "expiresAt"],
  "alert.raised": ["kind", "eventId", "tool", "action", "outcome", "reason", "policy", "permission", "blocked", "count", "windowMinutes", "authorizationId", "approvalId", "revoked"],
  "check_in": ["responses"],
  "checkin.requested": ["askId"], "checkin.request.delivered": ["askId"],
  "config.acknowledged": ["version"], "permission.granted": ["permission", "reviewId", "version"],
  "agent.paused": ["version"], "agent.resumed": ["version"], "integration.disabled": ["version"], "integration.enabled": ["version"],
  "policy.updated": ["version"], "key.rotated": [], "key.revoked": [],
};
/** Where the screen needs some text, it gets a neutral one rather than the agent's own words. */
const NEUTRAL: Record<string, Record<string, unknown>> = { "task.started": { title: "Task" } };

/**
 * Fields that are allowed through, but whose insides are not: a check-in's `responses` hold an answer and a confidence (both
 * enumerated) next to a free-text `explanation` the agent wrote. Visitors get only the enumerated parts.
 */
const NARROW: Record<string, (data: Record<string, unknown>) => Record<string, unknown>> = {
  check_in: (d) => {
    const r = d.responses;
    if (!r || typeof r !== "object") return {};
    return {
      responses: Object.fromEntries(
        Object.entries(r as Record<string, unknown>).map(([q, v]) => {
          const x = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
          return [q, { answer: x.answer, confidence: x.confidence }];
        }),
      ),
    };
  },
};

export function forViewer(e: WireEvent, v: Viewer, origin: Agent["origin"] = "connected"): WireEvent | null {
  if (v.role === "operator") return e;
  if (OPERATOR_ONLY.has(e.type)) return null;
  const data = { ...e.data };
  const liveOperatorContent = data.by !== undefined || (e.type === "check_in" && e.actor === "human");
  delete data.by; // the operator session that acted: an identifier for a sign-in, never for visitors
  if (origin === "demo" && !liveOperatorContent) return { ...e, data };
  const allowed = SHAPE[e.type] ?? [];
  const shown = Object.fromEntries(allowed.filter((k) => data[k] !== undefined).map((k) => [k, data[k]]));
  return { ...e, data: { ...(NARROW[e.type]?.(shown) ?? shown), ...NEUTRAL[e.type] } };
}

export function visibleTo(events: WireEvent[], v: Viewer, agents: Pick<Agent, "id" | "origin">[]) {
  const origin = new Map(agents.map((a) => [a.id, a.origin]));
  return events.flatMap((e) => forViewer(e, v, origin.get(e.agentId)) ?? []);
}
