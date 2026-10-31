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
// Also characters that render as nothing or as a blank and can carry hidden text: the combining grapheme joiner, the Hangul fillers, the
// braille blank, the tag characters (invisible ASCII look-alikes) and the supplementary variation selectors. Kept in step with the hooks
// adapter (examples/hooks/tend-hooks.mjs), which turns the same characters into spaces before it asks.
const INVISIBLE = new RegExp(`[${[
  [0x00, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x34f, 0x34f], [0x61c, 0x61c], [0x115f, 0x1160], [0x180e, 0x180e], [0x200b, 0x200f],
  [0x2028, 0x202e], [0x2060, 0x206f], [0x2800, 0x2800], [0x3164, 0x3164], [0xfeff, 0xfeff], [0xffa0, 0xffa0], [0xfff9, 0xfffb],
  [0xe0000, 0xe007f], [0xe0100, 0xe01ef],
].map(([a, b]) => `${String.fromCodePoint(a)}-${String.fromCodePoint(b)}`).join("")}]`, "u");
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

/**
 * Some values cannot be read by a condition: a summary an adapter sends for a long value ({ sha256, length }: strings over 256 characters,
 * long lists, deep objects), and an object or nested list where a plain value belongs. A condition on such a value is UNKNOWN, neither true
 * nor false, and the decision is then the strictest one the request could get whichever way it went (decidingRule): padding a value, or
 * sending a summary or an object in its place, can make a request stricter, never looser.
 */
type Match = boolean | "unknown";
const UNKNOWN = Symbol("unknown");
const summarized = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v) && typeof (v as { sha256?: unknown }).sha256 === "string";
/** The value at a dot path in the request's arguments, undefined, or UNKNOWN when the path runs into a summary. */
const at = (args: Record<string, unknown> | null, path: string) => {
  const v = path.split(".").reduce<unknown>((v, k) => (v === UNKNOWN || summarized(v) ? UNKNOWN
    : v && typeof v === "object" && !Array.isArray(v) && Object.hasOwn(v, k) ? (v as Record<string, unknown>)[k] : undefined), args);
  return summarized(v) ? UNKNOWN : v;
};
/** Compared as text, case-insensitive: 1001 and "1001" are one value, so a type change cannot step around a rule. */
const text = (x: unknown) => String(x).toLowerCase();
const scalar = (v: unknown) => typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null;
function holds(c: Condition, value: unknown): Match {
  const onlyExists = Object.keys(c).every((k) => k === "exists");
  if (value === UNKNOWN) return onlyExists ? c.exists !== false : "unknown";
  if (c.exists !== undefined && (value !== undefined) !== c.exists) return false;
  if (value === undefined) return onlyExists;
  if (onlyExists) return true;
  const values = Array.isArray(value) ? value : [value];
  if (!values.length) return false;
  if (!values.every(scalar)) return "unknown"; // an object, a nested list or a summary where a plain value belongs
  const each = (test: (v: unknown) => boolean) => values.every(test);
  if (c.equals !== undefined && !each((v) => v !== null && text(v) === text(c.equals))) return false;
  if (c.in && !each((v) => v !== null && c.in!.some((x) => text(x) === text(v)))) return false;
  // Not in the list: only for plain text or numbers; null or true is not a value outside the list, it is no value.
  if (c.notIn && !each((v) => (typeof v === "string" || typeof v === "number") && !c.notIn!.some((x) => text(x) === text(v)))) return false;
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
/** Whether a rule's conditions hold: true, false, or "unknown" when none fails and one cannot be read. A rule without conditions always does. */
export function conditionsMatch(when: Rule["when"], args: Record<string, unknown> | null): Match {
  if (!when) return true;
  let out: Match = true;
  for (const [path, c] of Object.entries(when)) {
    const m = holds(c, at(args, path));
    if (m === false) return false;
    if (m === "unknown") out = "unknown";
  }
  return out;
}

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
/** Whether a value nests deeper than `max`, without recursion (a value 20,000 levels deep must be refused, not overflow the stack). */
const tooDeep = (root: unknown, max: number) => {
  const stack: [unknown, number][] = [[root, 0]];
  while (stack.length) {
    const [v, d] = stack.pop()!;
    if (v && typeof v === "object") { if (d + 1 > max) return true; for (const x of Object.values(v)) stack.push([x, d + 1]); }
  }
  return false;
};

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
    else if (tooDeep(o.args, 5) || canonical(o.args).length > ARGS_MAX) errors.push(`args must be at most ${ARGS_MAX} characters of JSON, nested at most 5 deep`);
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
  const rule = decidingRule(parsed.rules, req);
  if (!rule) return { effect: "deny", reason: "no_policy" };
  if (rule.effect === "deny") return { effect: "deny", reason: "policy_denied" };
  if (rule.permission && !agent.permissions.includes(rule.permission)) return { effect: "deny", reason: "missing_permission" };
  const effect = rule.effect === "allow" && NEVER_AUTOMATIC.has(req.tool) ? "approve" : rule.effect;
  return { effect, reason: effect === "allow" ? "policy_allowed" : "approval_required" };
}

/**
 * The rule that decides a request: among the matching rules the most specific, the stricter one at equal specificity. A deny or approve rule
 * whose conditions are unknown (see holds) might match; where it would then win (at least as specific as the sure winner) and is stricter,
 * it decides. Unknown allow rules are left out, and with no sure winner nothing decides (TEND's default then blocks), because that is the
 * stricter of "it matched" and "it did not".
 */
export function decidingRule(rules: Rule[], req: AuthRequest): Rule | undefined {
  const inScope = rules.filter((r) =>
    r.tool === req.tool && (r.action === "*" || r.action === req.action) && (r.resourcePrefix === undefined || (req.resource !== null && req.resource.startsWith(r.resourcePrefix))));
  const sure: Rule[] = [], maybe: Rule[] = [];
  for (const r of inScope) { const m = conditionsMatch(r.when, req.args ?? null); if (m === true) sure.push(r); else if (m === "unknown" && r.effect !== "allow") maybe.push(r); }
  const winner = sure.length ? sure.reduce((a, b) => (specificity(b) > specificity(a) || (specificity(b) === specificity(a) && strength[b.effect] > strength[a.effect]) ? b : a)) : undefined;
  if (!winner) return maybe.find((r) => r.effect === "deny");
  return maybe.filter((r) => specificity(r) >= specificity(winner)).reduce((a, b) => (strength[b.effect] > strength[a.effect] ? b : a), winner);
}

/**
 * The rule behind an effective decision, recorded with the request so a person sees which of their rules decided it. Only decisions a rule
 * made have one (not a paused agent, a switched-off integration or "no rule covers it"); it is the same evaluation, read again.
 */
export function ruleBehind(d: EffectiveDecision, rawPolicy: unknown, central: unknown, req: AuthRequest): Rule | undefined {
  if (!["policy_allowed", "approval_required", "policy_denied", "missing_permission"].includes(d.reason)) return undefined;
  const parsed = parsePolicy(d.source === "central" ? central : rawPolicy);
  return parsed.ok ? decidingRule(parsed.rules, req) : undefined;
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
