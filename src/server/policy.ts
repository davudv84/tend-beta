// Server-side policy for pre-execution authorization. Pure functions, no database.
// Everything fails closed: a missing, malformed or unreadable policy, an unknown tool, a paused agent
// or an invalid request all end in "deny". Nothing here trusts a field the agent sent about itself.
import { createHash } from "node:crypto";
import type { Agent } from "../lib/types";

export const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const PERMISSION = /^[a-z][a-z0-9_.-]*$/;
export const DETAIL_MAX = 200;
/**
 * Control, zero-width and bidirectional-override characters. A person approves `detail` by reading it, so nothing in it
 * may render differently from what it is (U+202E can make "to X, EUR 5" display reversed). Built from code points so
 * the source holds no invisible characters itself.
 */
const INVISIBLE = new RegExp(`[${[
  [0x00, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x61c, 0x61c], [0x180e, 0x180e], [0x200b, 0x200f],
  [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff], [0xfff9, 0xfffb],
].map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`).join("")}]`);
const MAX_RULES = 50;

export type Effect = "allow" | "approve" | "deny";

/**
 * Gateway tools that spend money. No rule can let them run without a person: `allow` is treated as `approve` when a
 * request is evaluated (so a policy saved earlier is covered too), and a policy that contains such a rule is refused when saved.
 * Only tools Tend knows are listed; an agent's own tool names (the cooperative flow) are the operator's to govern.
 */
export const NEVER_AUTOMATIC: ReadonlySet<string> = new Set(["pay_invoice"]);
export interface Rule { tool: string; action: string; resourcePrefix?: string; effect: Effect; permission?: string }
const EFFECTS: Effect[] = ["allow", "approve", "deny"];
const RULE_KEYS = new Set(["tool", "action", "resourcePrefix", "effect", "permission"]);

export type PolicyResult = { ok: true; rules: Rule[] } | { ok: false; error: string };

/** What is wrong with a parsed policy that is otherwise well formed, if anything. Checked when a policy is saved. */
export function policyProblem(rules: Rule[]): string | undefined {
  const i = rules.findIndex((r) => r.effect === "allow" && NEVER_AUTOMATIC.has(r.tool));
  return i < 0 ? undefined : `rule ${i + 1}: ${rules[i].tool} spends money, so it can only ask for approval or be denied`;
}

/** Strict: one bad rule, an unknown key or a wrong type invalidates the whole policy (which then denies everything). */
export function parsePolicy(raw: unknown): PolicyResult {
  let v = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      return { ok: false, error: "policy is not valid JSON" };
    }
  }
  if (!Array.isArray(v)) return { ok: false, error: "policy must be an array of rules" };
  if (v.length > MAX_RULES) return { ok: false, error: `policy has more than ${MAX_RULES} rules` };
  const rules: Rule[] = [];
  for (const [i, r] of v.entries()) {
    const at = `rule ${i + 1}`;
    if (!r || typeof r !== "object" || Array.isArray(r)) return { ok: false, error: `${at} must be an object` };
    const o = r as Record<string, unknown>;
    for (const k of Object.keys(o)) if (!RULE_KEYS.has(k)) return { ok: false, error: `${at}: unknown field ${k}` };
    if (typeof o.tool !== "string" || !ID.test(o.tool)) return { ok: false, error: `${at}: tool must be 1–64 characters of letters, digits, _ . : -` };
    if (typeof o.action !== "string" || (o.action !== "*" && !ID.test(o.action))) return { ok: false, error: `${at}: action must be * or an identifier` };
    if (typeof o.effect !== "string" || !EFFECTS.includes(o.effect as Effect)) return { ok: false, error: `${at}: effect must be one of ${EFFECTS.join(", ")}` };
    if (o.resourcePrefix !== undefined && (typeof o.resourcePrefix !== "string" || !ID.test(o.resourcePrefix))) return { ok: false, error: `${at}: resourcePrefix must be an identifier` };
    if (o.permission !== undefined && (typeof o.permission !== "string" || o.permission.length > 80 || !PERMISSION.test(o.permission))) return { ok: false, error: `${at}: permission must look like docs.restricted.read` };
    rules.push({ tool: o.tool, action: o.action, effect: o.effect as Effect, ...(o.resourcePrefix !== undefined && { resourcePrefix: o.resourcePrefix }), ...(o.permission !== undefined && { permission: o.permission }) });
  }
  return { ok: true, rules };
}

export interface AuthRequest { tool: string; action: string; resource: string | null; detail: string | null }

/**
 * Validates what an agent asks to do. Strict on purpose: no coercion, no trimming, no truncation
 * (two different payments must never collapse into the same request) and no unknown fields.
 */
export function parseAuthRequest(input: unknown): { ok: true; request: AuthRequest } | { ok: false; errors: string[] } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, errors: ["body must be a JSON object"] };
  const o = input as Record<string, unknown>;
  const errors: string[] = [];
  for (const k of Object.keys(o)) if (!["tool", "action", "resource", "detail"].includes(k)) errors.push(`unknown field ${k}`);
  const ident = (k: string, optional: boolean) => {
    const v = o[k];
    if (v === undefined || v === null) {
      if (!optional) errors.push(`${k} is required`);
      return null;
    }
    if (typeof v !== "string" || !ID.test(v)) {
      errors.push(`${k} must be 1–64 characters of letters, digits, _ . : -`);
      return null;
    }
    return v;
  };
  const tool = ident("tool", false), action = ident("action", false), resource = ident("resource", true);
  let detail: string | null = null;
  if (o.detail !== undefined && o.detail !== null) {
    if (typeof o.detail !== "string" || o.detail.length === 0 || o.detail.length > DETAIL_MAX || INVISIBLE.test(o.detail)) errors.push(`detail must be 1–${DETAIL_MAX} printable characters`);
    else detail = o.detail;
  }
  if (errors.length || !tool || !action) return { ok: false, errors };
  return { ok: true, request: { tool, action, resource, detail } };
}

/** What an authorization is bound to. A JSON array, so no field can bleed into the next. */
export const fingerprint = (agentId: string, r: AuthRequest) =>
  createHash("sha256").update(JSON.stringify([agentId, r.tool, r.action, r.resource, r.detail])).digest("hex");

export type Decision = { effect: Effect; reason: string };

/** How specific a rule is. A more specific rule overrides a broader one. */
const specificity = (r: Rule) => (r.action === "*" ? 0 : 1000) + (r.resourcePrefix?.length ?? 0);
const strength: Record<Effect, number> = { deny: 3, approve: 2, allow: 1 };

/**
 * The decision for one request. Order: agent state, policy validity, matching rule, held permission.
 * Among matching rules the most specific wins; at equal specificity the stricter effect wins.
 * `agent.permissions` is server data, never taken from the request.
 */
export function evaluate(agent: Pick<Agent, "status" | "integrationEnabled" | "permissions">, rawPolicy: unknown, req: AuthRequest): Decision {
  if (!agent.integrationEnabled) return { effect: "deny", reason: "integration_disabled" };
  if (agent.status === "paused") return { effect: "deny", reason: "agent_paused" };
  const parsed = parsePolicy(rawPolicy);
  if (!parsed.ok) return { effect: "deny", reason: "invalid_policy" };
  const hits = parsed.rules.filter((r) =>
    r.tool === req.tool && (r.action === "*" || r.action === req.action) && (r.resourcePrefix === undefined || (req.resource !== null && req.resource.startsWith(r.resourcePrefix))));
  if (!hits.length) return { effect: "deny", reason: "no_policy" };
  const rule = hits.reduce((a, b) => (specificity(b) > specificity(a) || (specificity(b) === specificity(a) && strength[b.effect] > strength[a.effect]) ? b : a));
  if (rule.effect === "deny") return { effect: "deny", reason: "policy_denied" };
  if (rule.permission && !agent.permissions.includes(rule.permission)) return { effect: "deny", reason: "missing_permission" };
  const effect = rule.effect === "allow" && NEVER_AUTOMATIC.has(req.tool) ? "approve" : rule.effect;
  return { effect, reason: effect === "allow" ? "policy_allowed" : "approval_required" };
}
