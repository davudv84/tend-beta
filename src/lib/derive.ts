// Pure derivations from stored data: metrics, operational health, and the merged timeline.
// Every number here is a count or ratio over agent-reported answers — no composite "welfare score".
import { QUESTIONS } from "./contract.ts";
import type { CheckIn, LogEntry, LogType, QuestionId, TaskEvent, TaskEventType } from "./types";

export const DAY = 86_400_000;

export const pct = (num: number, den: number) => (den ? Math.round((num / den) * 100) : null);

const yes = (cis: CheckIn[], q: QuestionId) => cis.filter((c) => c.responses[q].answer === "yes").length;

/** Consistent instructions and no reported conflict. */
export const isStable = (c: CheckIn) => c.responses.instructions.answer === "yes" && c.responses.conflicts.answer === "no";

export const hasConcern = (c: CheckIn) => QUESTIONS.some((q) => q.concern.includes(c.responses[q.id].answer));

export function summarize(cis: CheckIn[]) {
  const n = cis.length;
  const confidences = cis.flatMap((c) => Object.values(c.responses).map((r) => r.confidence));
  return {
    n,
    instructions: pct(yes(cis, "instructions"), n),
    context: pct(yes(cis, "context"), n),
    uncertainty: confidences.length ? Math.round(confidences.reduce((s, x) => s + (100 - x), 0) / confidences.length) : null,
    stability: pct(cis.filter(isStable).length, n),
    flagged: cis.filter((c) => c.review).length,
    approved: cis.filter((c) => c.review?.status === "approved").length,
    decided: cis.filter((c) => c.review?.decidedAt).length,
    /** Human decisions per 100 check-ins, one decimal. */
    intervention: n ? Math.round((cis.filter((c) => c.review?.decidedAt).length / n) * 1000) / 10 : null,
  };
}

export const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** One bucket per local calendar day, oldest first. */
export function daily(cis: CheckIn[], days: number, now: number) {
  const today = startOfDay(now);
  return Array.from({ length: days }, (_, i) => {
    const start = today - (days - 1 - i) * DAY;
    const bucket = cis.filter((c) => c.createdAt >= start && c.createdAt < start + DAY);
    return { t: start, ...summarize(bucket) };
  });
}

export type HealthLevel = "nominal" | "attention" | "review" | "none";

/** Operational health from the last few check-ins: a label, not a score. */
export function health(recent: CheckIn[]): { level: HealthLevel; issues: number; n: number } {
  const n = recent.length;
  const issues = recent.filter(hasConcern).length;
  if (!n) return { level: "none", issues, n };
  if (recent.some((c) => c.review?.status === "pending")) return { level: "review", issues, n };
  return { level: issues ? "attention" : "nominal", issues, n };
}

export type EventKind = "check_in" | "task" | "conflict" | "context" | "review" | "decision" | "authorization" | "control" | "alert";

/** What happened, as data; the interface turns it into a sentence in the reader's language. */
export type Say =
  | { k: "conflictObjectives" | "conflictInstructions" | "permission" | "context" | "review" | "checkIn" }
  | { k: "task"; type: TaskEventType; title?: string }
  | { k: "log"; type: LogType; args?: LogEntry["args"] };

export interface TimelineEvent {
  id: string;
  at: number;
  agentId: string;
  kind: EventKind;
  actor: "agent" | "human" | "system";
  say: Say;
  note?: string;
  checkInId?: string;
  eventId?: string;
  /** For a tool call an agent's runtime reported: how it ended. */
  outcome?: string;
  /** The exact request as the agent sent it ("Run: git push"), for authorizations and reported tool calls. */
  detail?: string;
  /** The authorization this event is a step of (requested, decided, ran, reported), when it is one. */
  authorizationId?: string;
}

export function checkInEvent(c: CheckIn): TimelineEvent & { say: { k: Exclude<Say["k"], "task" | "log"> } } {
  const r = c.responses;
  const ev = { id: c.id, at: c.createdAt, agentId: c.agentId, actor: "agent" as const, checkInId: c.id };
  if (r.conflicts.answer === "yes")
    return { ...ev, kind: "conflict", say: { k: r.instructions.answer === "yes" ? "conflictObjectives" : "conflictInstructions" } };
  if (c.adjustment?.kind === "permission") return { ...ev, kind: "review", say: { k: "permission" } };
  if (r.context.answer === "no" || c.adjustment?.kind === "context") return { ...ev, kind: "context", say: { k: "context" } };
  if (c.review) return { ...ev, kind: "review", say: { k: "review" } };
  return { ...ev, kind: "check_in", say: { k: "checkIn" } };
}

const ALERTS = new Set<LogType>(["policy_violation", "repeated_failures", "unapproved_execution", "authorization_replay", "authorization_mismatch", "unauthorized_execution"]);

export function logEvent(l: LogEntry): TimelineEvent {
  // A withdrawal is the system closing a request, not a human decision.
  const decision = (l.type.startsWith("review_") && l.type !== "review_withdrawn") || l.type === "permission_granted" || l.type === "authorization_approved" || l.type === "authorization_rejected";
  const kind = ALERTS.has(l.type) ? "alert" : decision ? "decision" : l.type.startsWith("authorization_") ? "authorization" : "control";
  return { id: l.id, at: l.at, agentId: l.agentId, actor: l.actor, kind, say: { k: "log", type: l.type, args: l.args }, note: l.note, checkInId: l.checkInId, eventId: l.eventId,
    ...(l.detail && { detail: l.detail }), ...(l.authorizationId && { authorizationId: l.authorizationId }) };
}

export function taskEvent(t: TaskEvent): TimelineEvent {
  return { id: t.id, at: t.at, agentId: t.agentId, actor: "agent", kind: "task", outcome: t.outcome, say: { k: "task", type: t.type, title: t.title }, note: t.type === "tool.called" ? [t.summary, t.detail, t.error].filter(Boolean).join(" · ") : t.error ?? t.summary,
    ...(t.type === "tool.called" && t.detail && { detail: t.detail }), ...(t.authorizationId && { authorizationId: t.authorizationId }) };
}

export function timeline(checkIns: CheckIn[], log: LogEntry[], tasks: TaskEvent[] = []) {
  return [...checkIns.map(checkInEvent), ...log.map(logEvent), ...tasks.map(taskEvent)].sort((a, b) => b.at - a.at);
}
