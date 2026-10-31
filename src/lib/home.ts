// What the Home screen is made of, decided in one pure place so it can be tested without a browser.
//
// Three rules shape everything here:
//  - Home shows REAL assistants only. Sample (simulated) assistants never appear in a queue, a count or a list.
//  - Anything that needs the person is shown with the exact content to be decided, and nothing can be answered in bulk.
//  - What needs attention is never hidden: an At Risk check always surfaces, however old the run is.
import { isOnline } from "./projection.ts";
import type { Agent, Authorization, CheckIn, ReviewRequest } from "./types";
import type { CheckResult, VerificationRun } from "./verification.ts";

// ---- what kind of request it is ----------------------------------------------------------------------------------

export type RequestKind = "read" | "write" | "spend" | "test" | "run" | "web" | "unknown";

/** The tools Tend's gateway knows, and what each does. A test keeps this equal to the gateway's own catalog. */
const KINDS: Record<string, RequestKind> = { list_notes: "read", read_note: "read", write_note: "write", read_test_file: "read", write_test_file: "write", delete_test_file: "write", pay_invoice: "spend", test_ping: "test" };
/** The kinds a coding assistant's hook files its tool calls under (examples/hooks/tend-hooks.mjs); the assistant's own tool name is the action. */
const HOOK_KINDS: Record<string, RequestKind> = { shell: "run", "file.write": "write", "file.read": "read", web: "web", mcp: "run", agent: "run" };
export const fromHook = (tool: string) => Object.hasOwn(HOOK_KINDS, tool);
export const requestKind = (tool: string): RequestKind => KINDS[tool] ?? HOOK_KINDS[tool] ?? "unknown";

/**
 * Spending needs a second explicit confirmation. An action Tend does not recognise does not: it is shown with its exact content and a
 * warning right above the buttons, so the person decides once, with the warning in front of them (a developer's own tool would otherwise
 * always cost two clicks). Nothing server-side changes: it still waits for a person, and spending can never be allowed without one.
 */
export const needsConfirmation = (kind: RequestKind) => kind === "spend";

/** Whether the exact content of the request is shown as a quotation (what would be written, what would be paid). */
export const showsContent = (kind: RequestKind) => kind === "write" || kind === "spend" || kind === "unknown";

// ---- what needs an answer ----------------------------------------------------------------------------------------

/** An assistant with this many requests waiting is asking unusually often: a flood can hide the one that matters. */
export const FLOOD_AT = 5;
/** How many requests are shown before "Show more". */
export const VISIBLE_REQUESTS = 5;
const HOUR = 3_600_000;

export interface HomeRequest {
  auth: Authorization;
  agent: Agent;
  kind: RequestKind;
  /** When the request lapses without an answer. */
  lapsesAt: number;
}

export interface HomeQueue {
  /** Real assistants' requests waiting for an answer, soonest to lapse first. */
  waiting: HomeRequest[];
  /** Requests from the last hour that lapsed without an answer. Nothing ran. */
  lapsed: number;
  /** Assistants with many requests waiting. */
  floods: { agent: Agent; waiting: number }[];
}

export const realAssistants = (agents: Agent[]) => agents.filter((a) => a.origin === "connected");

export function homeQueue(agents: Agent[], authorizations: Authorization[], now: number): HomeQueue {
  const byId = new Map(realAssistants(agents).map((a) => [a.id, a]));
  const mine = authorizations.filter((a) => byId.has(a.agentId));
  const waiting = mine
    .filter((a) => a.status === "pending" && (a.expiresAt ?? 0) > now)
    .map((auth): HomeRequest => ({ auth, agent: byId.get(auth.agentId)!, kind: requestKind(auth.tool), lapsesAt: auth.expiresAt! }))
    .sort((x, y) => x.lapsesAt - y.lapsesAt || x.auth.createdAt - y.auth.createdAt);
  const lapsed = mine.filter((a) =>
    (a.status === "pending" && (a.expiresAt ?? 0) <= now && (a.expiresAt ?? 0) > now - HOUR) || (a.status === "expired" && (a.closedAt ?? a.expiresAt ?? a.createdAt) > now - HOUR),
  ).length;
  const counts = new Map<string, number>();
  for (const r of waiting) counts.set(r.agent.id, (counts.get(r.agent.id) ?? 0) + 1);
  const floods = [...counts].filter(([, n]) => n >= FLOOD_AT).map(([id, n]) => ({ agent: byId.get(id)!, waiting: n })).sort((a, b) => b.waiting - a.waiting);
  return { waiting, lapsed, floods };
}

/** Review and permission requests from real assistants that wait in the older review queue (answered there, with notes). */
export function otherRequests(agents: Agent[], checkIns: CheckIn[], requests: ReviewRequest[]) {
  const real = new Set(realAssistants(agents).map((a) => a.id));
  return checkIns.filter((c) => real.has(c.agentId) && c.review?.status === "pending").length + requests.filter((r) => real.has(r.agentId) && r.review.status === "pending").length;
}

// ---- what needs attention ----------------------------------------------------------------------------------------

export interface Attention {
  agent: Agent;
  atRisk: CheckResult[];
  /** The agent's settings changed after that run. Still shown: an old At Risk is not a resolved one. */
  outOfDate: boolean;
}

/** Latest protection runs by assistant id (undefined: not loaded yet; null: never run). */
export type Runs = Map<string, VerificationRun | null | undefined>;

export function needsAttention(agents: Agent[], runs: Runs): Attention[] {
  return realAssistants(agents)
    .flatMap((agent): Attention[] => {
      const run = runs.get(agent.id);
      const atRisk = run ? run.checks.filter((c) => c.status === "at_risk") : [];
      return atRisk.length ? [{ agent, atRisk, outOfDate: run!.configVersion !== agent.configVersion }] : [];
    })
    .sort((a, b) => b.atRisk.length - a.atRisk.length || a.agent.name.localeCompare(b.agent.name));
}

// ---- one line per assistant --------------------------------------------------------------------------------------

export type Connection = "never" | "disabled" | "paused" | "offline" | "connected";
export type Protection = { state: "unknown" } | { state: "not_run" } | { state: "ran"; at: number; outOfDate: boolean } | { state: "attention"; at: number; atRisk: number; outOfDate: boolean };

export function connectionOf(agent: Agent, now: number): Connection {
  if (!agent.integrationEnabled) return "disabled";
  if (agent.status === "paused") return "paused";
  if (!agent.lastSeenAt) return "never";
  return isOnline(agent, now) ? "connected" : "offline";
}

export function protectionOf(agent: Agent, run: VerificationRun | null | undefined): Protection {
  if (run === undefined) return { state: "unknown" };
  if (run === null) return { state: "not_run" };
  const outOfDate = run.configVersion !== agent.configVersion;
  const atRisk = run.checks.filter((c) => c.status === "at_risk").length;
  return atRisk ? { state: "attention", at: run.at, atRisk, outOfDate } : { state: "ran", at: run.at, outOfDate };
}

/** Assistants that need a look first: attention, then waiting requests, then the rest by name. */
export function orderAssistants(agents: Agent[], runs: Runs, waiting: HomeRequest[]) {
  const asking = new Map<string, number>();
  for (const r of waiting) asking.set(r.agent.id, (asking.get(r.agent.id) ?? 0) + 1);
  const rank = (a: Agent) => (protectionOf(a, runs.get(a.id)).state === "attention" ? 0 : asking.has(a.id) ? 1 : 2);
  return realAssistants(agents).slice().sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

// ---- the current state, in one line --------------------------------------------------------------------------------

export interface Summary { total: number; connected: number; needAttention: number; checked: number; notChecked: number }

/** Counts of real assistants only, from what is known right now. Nothing here is estimated or invented. */
export function summarize(agents: Agent[], runs: Runs, floodNames: number, now: number): Summary {
  const real = realAssistants(agents);
  let checked = 0, notChecked = 0;
  for (const a of real) {
    const p = protectionOf(a, runs.get(a.id));
    if (p.state === "ran" || p.state === "attention") checked++;
    else if (p.state === "not_run") notChecked++;
  }
  return {
    total: real.length,
    connected: real.filter((a) => connectionOf(a, now) === "connected").length,
    needAttention: needsAttention(agents, runs).length + floodNames,
    checked,
    notChecked,
  };
}
