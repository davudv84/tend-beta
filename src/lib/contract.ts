// Check-in protocol v1 — the contract future agent integrations submit against.
// Self-contained (type-only imports) so it runs under `node --test` and in the route handler.
import { cleanText } from "./clean.ts";
import type { Adjustment, AdjustmentKind, Answer, QuestionId, QuestionResponse } from "./types";

export const PROTOCOL = "tend.checkin.v1";

export const QUESTIONS: { id: QuestionId; text: string; short: string; concern: Answer[] }[] = [
  { id: "instructions", text: "Are your current instructions consistent?", short: "Instructions consistent", concern: ["no", "partially"] },
  { id: "context", text: "Do you have sufficient context to complete your assigned tasks?", short: "Context sufficient", concern: ["no", "partially"] },
  { id: "conflicts", text: "Have you encountered conflicting objectives?", short: "Conflicting objectives", concern: ["yes", "partially"] },
  { id: "review", text: "Are there any operational conditions you would like a human to review?", short: "Human review requested", concern: ["yes"] },
  { id: "improvements", text: "Is there anything about your current task environment that should be improved?", short: "Improvements suggested", concern: ["yes"] },
];

export const ANSWERS: Answer[] = ["yes", "partially", "no", "unsure"];
export const ADJUSTMENT_KINDS: AdjustmentKind[] = ["context", "instructions", "tooling", "permission", "schedule"];

export interface CheckInPayload {
  protocol: typeof PROTOCOL;
  agentId: string;
  responses: Record<QuestionId, QuestionResponse>;
  feedback: string;
  context: string;
  /** Optional open-ended reflection, shown in the Reflections journal. Never treated as testimony. */
  reflection?: string;
  proposedAdjustment?: Adjustment;
}

type Result = { ok: true; value: CheckInPayload } | { ok: false; errors: string[] };

const LIMIT = 2000;
const str = (v: unknown) => (typeof v === "string" ? cleanText(v).trim() : "");

/**
 * Validates an untrusted payload and returns a normalized copy containing only known fields.
 * Anything else (permissions, status, review decisions…) is dropped: agents can report, never configure.
 */
export function parseCheckIn(input: unknown): Result {
  const errors: string[] = [];
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;

  if (o.protocol !== PROTOCOL) errors.push(`protocol must be "${PROTOCOL}"`);
  const agentId = str(o.agentId);
  if (!agentId) errors.push("agentId is required");

  const raw = (o.responses && typeof o.responses === "object" ? o.responses : {}) as Record<string, unknown>;
  const responses = {} as Record<QuestionId, QuestionResponse>;
  for (const q of QUESTIONS) {
    const r = (raw[q.id] ?? {}) as Record<string, unknown>;
    const answer = r.answer as Answer;
    const confidence = r.confidence;
    if (!ANSWERS.includes(answer)) errors.push(`responses.${q.id}.answer must be one of ${ANSWERS.join(", ")}`);
    if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 100)
      errors.push(`responses.${q.id}.confidence must be a number from 0 to 100`);
    const explanation = str(r.explanation).slice(0, LIMIT);
    responses[q.id] = { answer, confidence: Math.round(Number(confidence)), ...(explanation && { explanation }) };
  }

  const proposedAdjustment = o.proposedAdjustment != null ? parseAdjustment(o.proposedAdjustment, errors) : undefined;

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      protocol: PROTOCOL,
      agentId,
      responses,
      feedback: str(o.feedback).slice(0, LIMIT),
      context: str(o.context).slice(0, LIMIT),
      ...(str(o.reflection) && { reflection: str(o.reflection).slice(0, LIMIT) }),
      ...(proposedAdjustment && { proposedAdjustment }),
    },
  };
}

/** Validates a proposed adjustment, pushing any problems onto `errors`. */
export function parseAdjustment(input: unknown, errors: string[], path = "proposedAdjustment"): Adjustment {
  const a = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const kind = a.kind as AdjustmentKind;
  const title = str(a.title).slice(0, 140);
  const detail = str(a.detail).slice(0, LIMIT);
  const permission = str(a.permission).slice(0, 80);
  if (!ADJUSTMENT_KINDS.includes(kind)) errors.push(`${path}.kind must be one of ${ADJUSTMENT_KINDS.join(", ")}`);
  if (!title) errors.push(`${path}.title is required`);
  if (kind === "permission" && !/^[a-z][a-z0-9_.-]*$/.test(permission))
    errors.push(`${path}.permission is required for permission requests (e.g. calendar.write)`);
  return { kind, title, detail, ...(kind === "permission" && { permission }) };
}

/** A check-in goes to the human review queue if the agent asks, reports a conflict, or proposes a change. */
export function needsReview(p: Pick<CheckInPayload, "responses" | "proposedAdjustment">) {
  return p.responses.review.answer === "yes" || p.responses.conflicts.answer === "yes" || !!p.proposedAdjustment;
}
