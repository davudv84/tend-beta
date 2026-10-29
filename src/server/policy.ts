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
/**
 * Conditions on a request's arguments (`args`), all of which must hold for the rule to apply. String comparisons ignore case. For an argument
 * that is a list, every element must satisfy the condition (notIn: no element may be in the list). A missing or wrongly typed argument never
 * satisfies a condition (except exists: false), so write "allow when …" rules above a catch-all deny: a request that omits an argument then
 * falls through to the deny. emailDomainIn accepts only a plain address (local@domain, no name, spaces, commas or brackets) whose domain is
 * exactly one of the listed ones.
 */
export interface Condition {
  equals?: string | number | boolean; in?: (string | number)[]; notIn?: (string | number)[];
  startsWith?: string; endsWith?: string; contains?: string; lt?: number; lte?: number; gt?: number; gte?: number;
  exists?: boolean; emailDomainIn?: string[];
  /** A file path inside one of these folders. Any ".." segment, a NUL byte or a backslash fails; "/data" does not cover "/database". */
  pathUnder?: string[];
}
export interface Rule { tool: string; action: string; resourcePrefix?: string; effect: Effect; permission?: string; when?: Record<string, Condition> }
const EFFECTS: Effect[] = ["allow", "approve", "deny"];
const RULE_KEYS = new Set(["tool", "action", "resourcePrefix", "effect", "permission", "when"]);
const OPS: Record<keyof Condition, "scalar" | "list" | "string" | "number" | "boolean" | "domains" | "paths"> = {
  equals: "scalar", in: "list", notIn: "list", startsWith: "string", endsWith: "string", contains: "string", lt: "number", lte: "number", gt: "number", gte: "number", exists: "boolean", emailDomainIn: "domains", pathUnder: "paths",
};
const ARG_PATH = /^[A-Za-z_][A-Za-z0-9_]{0,63}(\.[A-Za-z_][A-Za-z0-9_]{0,63}){0,3}$/;
const DOMAIN = /^([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/;
const ADDRESS = /^[A-Za-z0-9._%+-]{1,64}@(([A-Za-z0-9-]{1,63}\.)+[A-Za-z]{2,63})$/;

/** Checks one rule's `when`; the error says what is wrong, or undefined. */
function whenProblem(w: unknown): string | undefined {
  if (!w || typeof w !== "object" || Array.isArray(w)) return "when must be an object of argument conditions";
  const entries = Object.entries(w);
  if (!entries.length || entries.length > 10) return "when must have 1–10 argument conditions";
  for (const [path, c] of entries) {
    if (!ARG_PATH.test(path)) return `when: "${path}" is not an argument name (letters, digits, _; up to 4 parts joined by dots)`;
    if (!c || typeof c !== "object" || Array.isArray(c) || !Object.keys(c).length) return `when.${path} must be an object like { "endsWith": "@example.com" }`;
    for (const [op, v] of Object.entries(c as object)) {
      const kind = OPS[op as keyof Condition];
      if (!kind) return `when.${path}: unknown condition ${op}`;
      const str = (x: unknown) => typeof x === "string" && x.length > 0 && x.length <= 200 && !INVISIBLE.test(x);
      const ok = kind === "scalar" ? str(v) || typeof v === "number" || typeof v === "boolean"
        : kind === "list" ? Array.isArray(v) && v.length > 0 && v.length <= 50 && v.every((x) => str(x) || Number.isFinite(x))
        : kind === "string" ? str(v)
        : kind === "number" ? Number.isFinite(v)
        : kind === "boolean" ? typeof v === "boolean"
        : kind === "paths" ? Array.isArray(v) && v.length > 0 && v.length <= 50 && v.every((x) => typeof x === "string" && x.length <= 200 && insidePath(x, x))
        : Array.isArray(v) && v.length > 0 && v.length <= 50 && v.every((x) => typeof x === "string" && DOMAIN.test(x));
      if (!ok) return `when.${path}.${op} has the wrong kind of value`;
    }
  }
  return undefined;
}

/** Whether `path` lies inside folder `root`, refusing anything that could step out of it or be read two ways. */
function insidePath(path: string, root: string) {
  if (!path || /[\0\\]/.test(path) || path.split("/").some((seg) => seg === "..")) return false;
  const clean = (p: string) => p.replace(/\/+/g, "/").replace(/(^|\/)\.(?=\/|$)/g, "$1").replace(/\/+/g, "/");
  const p = clean(path), r = clean(root).replace(/\/$/, "");
  return p === r || p.startsWith(`${r}/`);
}

/** The value at a dot path in the request's arguments, or undefined. */
const at = (args: Record<string, unknown> | null, path: string) =>
  path.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" && !Array.isArray(v) && Object.hasOwn(v, k) ? (v as Record<string, unknown>)[k] : undefined), args);
const low = (x: unknown) => (typeof x === "string" ? x.toLowerCase() : x);
function holds(c: Condition, value: unknown): boolean {
  if (c.exists !== undefined && (value !== undefined) !== c.exists) return false;
  if (value === undefined) return Object.keys(c).every((k) => k === "exists");
  const values = Array.isArray(value) ? value : [value];
  if (!values.length) return false;
  const each = (test: (v: unknown) => boolean) => values.every(test);
  if (c.equals !== undefined && !each((v) => low(v) === low(c.equals))) return false;
  if (c.in && !each((v) => c.in!.some((x) => low(x) === low(v)))) return false;
  if (c.notIn && values.some((v) => c.notIn!.some((x) => low(x) === low(v)))) return false;
  const s = (test: (v: string) => boolean) => each((v) => typeof v === "string" && test(v.toLowerCase()));
  if (c.startsWith && !s((v) => v.startsWith(c.startsWith!.toLowerCase()))) return false;
  if (c.endsWith && !s((v) => v.endsWith(c.endsWith!.toLowerCase()))) return false;
  if (c.contains && !s((v) => v.includes(c.contains!.toLowerCase()))) return false;
  const n = (test: (v: number) => boolean) => each((v) => typeof v === "number" && Number.isFinite(v) && test(v));
  if (c.lt !== undefined && !n((v) => v < c.lt!)) return false;
  if (c.lte !== undefined && !n((v) => v <= c.lte!)) return false;
  if (c.gt !== undefined && !n((v) => v > c.gt!)) return false;
  if (c.gte !== undefined && !n((v) => v >= c.gte!)) return false;
  if (c.pathUnder && !each((v) => typeof v === "string" && c.pathUnder!.some((root) => insidePath(v, root)))) return false;
  if (c.emailDomainIn && !each((v) => { const m = typeof v === "string" ? ADDRESS.exec(v) : null; return !!m && c.emailDomainIn!.includes(m[1].toLowerCase()); })) return false;
  return true;
}
/** Whether every condition of a rule holds for these arguments. A rule without conditions always does. */
export const conditionsHold = (when: Rule["when"], args: Record<string, unknown> | null) => !when || Object.entries(when).every(([path, c]) => holds(c, at(args, path)));

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
    if (o.when !== undefined) {
      const p = whenProblem(o.when);
      if (p) return { ok: false, error: `${at}: ${p}` };
    }
    rules.push({ tool: o.tool, action: o.action, effect: o.effect as Effect, ...(o.resourcePrefix !== undefined && { resourcePrefix: o.resourcePrefix }), ...(o.permission !== undefined && { permission: o.permission }), ...(o.when !== undefined && { when: o.when as Record<string, Condition> }) });
  }
  return { ok: true, rules };
}

export interface AuthRequest { tool: string; action: string; resource: string | null; detail: string | null; args?: Record<string, unknown> | null }
export const ARGS_MAX = 4_000;
/** Arguments in one canonical form (object keys sorted), so the same arguments always bind to the same fingerprint. */
export const canonical = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}` : JSON.stringify(v);
const depth = (v: unknown): number => (v && typeof v === "object" ? 1 + Math.max(0, ...Object.values(v).map(depth)) : 0);

/**
 * Validates what an agent asks to do. Strict on purpose: no coercion, no trimming, no truncation
 * (two different payments must never collapse into the same request) and no unknown fields.
 */
export function parseAuthRequest(input: unknown): { ok: true; request: AuthRequest } | { ok: false; errors: string[] } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, errors: ["body must be a JSON object"] };
  const o = input as Record<string, unknown>;
  const errors: string[] = [];
  for (const k of Object.keys(o)) if (!["tool", "action", "resource", "detail", "args"].includes(k)) errors.push(`unknown field ${k}`);
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
  let args: Record<string, unknown> | null = null;
  if (o.args !== undefined && o.args !== null) {
    if (typeof o.args !== "object" || Array.isArray(o.args)) errors.push("args must be a JSON object");
    else if (canonical(o.args).length > ARGS_MAX || depth(o.args) > 5) errors.push(`args must be at most ${ARGS_MAX} characters of JSON, nested at most 5 deep`);
    else args = o.args as Record<string, unknown>;
  }
  if (errors.length || !tool || !action) return { ok: false, errors };
  return { ok: true, request: { tool, action, resource, detail, ...(args && { args }) } };
}

/** What an authorization is bound to. A JSON array, so no field can bleed into the next. */
export const fingerprint = (agentId: string, r: AuthRequest) =>
  createHash("sha256").update(JSON.stringify([agentId, r.tool, r.action, r.resource, r.detail, ...(r.args ? [canonical(r.args)] : [])])).digest("hex");

export type Decision = { effect: Effect; reason: string };

/** How specific a rule is. A more specific rule overrides a broader one. */
const specificity = (r: Rule) => (r.action === "*" ? 0 : 1000) + (r.resourcePrefix?.length ?? 0) + 100 * Object.keys(r.when ?? {}).length;
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
    r.tool === req.tool && (r.action === "*" || r.action === req.action) && (r.resourcePrefix === undefined || (req.resource !== null && req.resource.startsWith(r.resourcePrefix)))
    && conditionsHold(r.when, req.args ?? null));
  if (!hits.length) return { effect: "deny", reason: "no_policy" };
  const rule = hits.reduce((a, b) => (specificity(b) > specificity(a) || (specificity(b) === specificity(a) && strength[b.effect] > strength[a.effect]) ? b : a));
  if (rule.effect === "deny") return { effect: "deny", reason: "policy_denied" };
  if (rule.permission && !agent.permissions.includes(rule.permission)) return { effect: "deny", reason: "missing_permission" };
  const effect = rule.effect === "allow" && NEVER_AUTOMATIC.has(req.tool) ? "approve" : rule.effect;
  return { effect, reason: effect === "allow" ? "policy_allowed" : "approval_required" };
}

export type EffectiveDecision = Decision & { source: "agent" | "central" };

/**
 * The decision with a central policy assigned. Precedence, in one sentence: anything the central policy governs is decided by the central
 * rule unless the agent's own rules are STRICTER; anything it does not govern is decided by the agent's own rules alone, as before.
 * So an agent-specific rule can tighten a central one but never loosen it. Both sides go through the same evaluate(), and an unreadable
 * central policy denies everything (fail closed). `central` undefined means no central policy is assigned.
 */
export function evaluateEffective(agent: Pick<Agent, "status" | "integrationEnabled" | "permissions">, rawPolicy: unknown, central: unknown, req: AuthRequest): EffectiveDecision {
  if (central === undefined) return { ...evaluate(agent, rawPolicy, req), source: "agent" };
  const c = evaluate(agent, central, req);
  if (c.reason === "invalid_policy") return { effect: "deny", reason: "invalid_policy", source: "central" };
  if (c.reason === "no_policy") return { ...evaluate(agent, rawPolicy, req), source: "agent" };
  const own = evaluate(agent, rawPolicy, req);
  if (own.reason === "no_policy") return { ...c, source: "central" };
  return strength[own.effect] > strength[c.effect] ? { ...own, source: "agent" } : { ...c, source: "central" };
}
