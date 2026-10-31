// Persistence and domain rules. Every state change writes an event in the same transaction.
// Lock rule: every write transaction takes the event lock (q.lockEvents) before touching any row,
// so writers queue in one order and can't deadlock; the demo takes its own lock just before it.
import { cleanText } from "../lib/clean.ts";
import { randomBytes, randomUUID } from "node:crypto";
import { needsReview, parseAdjustment, parseCheckIn } from "../lib/contract.ts";
import type { Actor, EventType, WireEvent } from "../lib/projection.ts";
import type { Agent, Provider, ToolOutcome } from "../lib/types";
import { sweepExpired, TTL } from "./authz.ts";
import { hashKey, newKey } from "./auth.ts";
import type { DB, Q } from "./db.ts";
import { HttpError, spend } from "./http.ts";
import { notifyFor } from "./notifications.ts";
import { parsePolicy, policyProblem } from "./policy.ts";
import { DEFAULT_WORKSPACE } from "./session.ts";

/** Postgres BIGINT columns hold whole milliseconds. */
const ms = (t: number) => Math.round(t);

// ---- agents ----------------------------------------------------------------------------------

interface AgentRow {
  id: string; profile: string; origin: "demo" | "connected"; status: Agent["status"]; integration_enabled: number;
  permissions: string; public: number; key_hash: string | null; key_prefix: string | null; config_version: number;
  acked_version: number; created_at: number; last_seen_at: number | null; disconnected_at: number | null;
  /** Enforcement settings stay out of `Agent` on purpose: that type is sent to browsers, and a policy is not for visitors. */
  enforcement: "monitor" | "enforce"; policy: string;
  /** The central policy this agent is assigned to, if any (central_policies.id). */
  central_policy_id: string | null;
  /** Which workspace the agent belongs to (workspaces.id). Everything about the agent is visible only there. */
  workspace_id: string;
}

export interface Profile { name: string; model: string; provider: Provider; role: string; description: string; cadenceHours: number }

export function toAgent(r: AgentRow): Agent {
  const p = JSON.parse(r.profile) as Profile;
  return {
    id: r.id, ...p, status: r.status, integrationEnabled: !!r.integration_enabled, permissions: JSON.parse(r.permissions),
    connectedAt: r.created_at, origin: r.origin, configVersion: r.config_version, ackedVersion: r.acked_version, public: !!r.public,
    ...(r.last_seen_at && { lastSeenAt: r.last_seen_at }), ...(r.disconnected_at && { disconnectedAt: r.disconnected_at }),
  };
}

export const agentRow = (q: Q, id: string) => q.get<AgentRow>("SELECT * FROM agents WHERE id = ?", id);
export const getAgent = async (q: Q, id: string) => {
  const r = await agentRow(q, id);
  return r ? toAgent(r) : undefined;
};
/** Every agent, or with `workspace` only that workspace's. */
export const allAgents = async (q: Q, workspace?: string) =>
  (await q.all<AgentRow>(`SELECT * FROM agents ${workspace ? "WHERE workspace_id = ? " : ""}ORDER BY origin DESC, created_at, id`, ...(workspace ? [workspace] : []))).map(toAgent);

// Which key each agent object was authenticated with, kept beside the object (never in it, so it cannot end up in a response).
const presented = new WeakMap<object, string>();
export async function agentByKey(q: Q, key: string) {
  const hash = hashKey(key);
  const r = await q.get<AgentRow>("SELECT * FROM agents WHERE key_hash = ?", hash);
  if (!r) return undefined;
  const agent = toAgent(r);
  presented.set(agent, hash);
  return agent;
}
/**
 * Whether the key an agent was authenticated with is no longer its key. Checked again inside each authorization transaction, under the lock:
 * the key is looked up before the transaction starts, and a revocation that commits in between must win.
 */
export const keyRevoked = (row: Pick<AgentRow, "key_hash"> | undefined, agent: object) => {
  const hash = presented.get(agent);
  return hash !== undefined && row?.key_hash !== hash;
};

export function insertAgent(q: Q, a: Agent, keyHash?: string, keyPrefix?: string, workspace = DEFAULT_WORKSPACE) {
  const profile: Profile = { name: a.name, model: a.model, provider: a.provider, role: a.role, description: a.description, cadenceHours: a.cadenceHours };
  return q.run(`INSERT INTO agents (id, profile, origin, status, integration_enabled, permissions, public, key_hash, key_prefix, config_version, acked_version, created_at, workspace_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    a.id, JSON.stringify(profile), a.origin, a.status, a.integrationEnabled ? 1 : 0, JSON.stringify(a.permissions), a.public ? 1 : 0, keyHash ?? null, keyPrefix ?? null, a.configVersion, a.ackedVersion, ms(a.connectedAt), workspace);
}

// ---- workspaces --------------------------------------------------------------------------------
// A route that takes an id checks it belongs to the caller's workspace before doing anything. An id from another workspace gets the
// same 404 as one that does not exist, so nothing about other workspaces can be learned by trying ids.

export async function agentInWorkspace(q: Q, workspace: string, agentId: string) {
  const r = await q.get<{ workspace_id: string }>("SELECT workspace_id FROM agents WHERE id = ?", agentId);
  if (!r || r.workspace_id !== workspace) throw new HttpError(404, "agent_not_found", `No agent with id “${agentId}”.`);
}
/** A review or an authorization (approvals are decided by the same id). */
export async function reviewInWorkspace(q: Q, workspace: string, id: string) {
  const r = await q.get<{ workspace_id: string }>("SELECT a.workspace_id FROM agents a WHERE a.id = COALESCE((SELECT agent_id FROM reviews WHERE id = ?), (SELECT agent_id FROM authorizations WHERE id = ?))", id, id);
  if (!r || r.workspace_id !== workspace) throw new HttpError(404, "review_not_found", "No review with that id.");
}
export async function centralInWorkspace(q: Q, workspace: string, id: string) {
  const r = await q.get<{ workspace_id: string }>("SELECT workspace_id FROM central_policies WHERE id = ?", id);
  if (!r || r.workspace_id !== workspace) throw new HttpError(404, "central_policy_not_found", `No central policy with id “${id}”.`);
}

// ---- events ----------------------------------------------------------------------------------

interface EventRow { seq: number; id: string; agent_id: string; type: EventType; at: number; actor: Actor; data: string }
export const toWire = (r: EventRow): WireEvent => ({ seq: r.seq, id: r.id, agentId: r.agent_id, type: r.type, at: r.at, actor: r.actor, data: JSON.parse(r.data) });

type NewEvent = { agentId: string; type: EventType; actor: Actor; data?: object; at?: number; id?: string; idempotencyKey?: string };
const eventId = () => `ev_${randomUUID().replaceAll("-", "").slice(0, 16)}`;

/** Appends one event. Must run inside a transaction (it takes the event-order lock). */
export async function insertEvent(q: Q, e: NewEvent): Promise<WireEvent> {
  await q.lockEvents();
  const id = e.id ?? eventId();
  const at = ms(e.at ?? Date.now());
  const r = await q.get<{ seq: number }>("INSERT INTO events (id, agent_id, type, at, actor, data, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING seq",
    id, e.agentId, e.type, at, e.actor, JSON.stringify(e.data ?? {}), e.idempotencyKey ?? null);
  const wire: WireEvent = { seq: r!.seq, id, agentId: e.agentId, type: e.type, at, actor: e.actor, data: (e.data ?? {}) as Record<string, unknown> };
  // Every event passes here, so this is the one place notifications come from: same transaction, nothing to forget on another path.
  await notifyFor(q, wire);
  return wire;
}

/** Appends many events in order, a few hundred per statement (seeding). */
export async function insertEvents(q: Q, list: NewEvent[]) {
  await q.lockEvents();
  for (let i = 0; i < list.length; i += 250) {
    const chunk = list.slice(i, i + 250);
    const params = chunk.flatMap((e) => [e.id ?? eventId(), e.agentId, e.type, ms(e.at ?? Date.now()), e.actor, JSON.stringify(e.data ?? {}), e.idempotencyKey ?? null]);
    await q.run(`INSERT INTO events (id, agent_id, type, at, actor, data, idempotency_key) VALUES ${chunk.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(", ")}`, ...params);
  }
}

export const eventsAfter = async (q: Q, seq: number, n: number) => (await q.all<EventRow>("SELECT * FROM events WHERE seq > ? ORDER BY seq LIMIT ?", seq, n)).map(toWire);
/** The latest events, oldest first. With `agentIds`, only theirs: the limit is then per viewer, so another workspace's volume cannot crowd them out. */
export const recentEvents = async (q: Q, since: number, n: number, agentIds?: string[]) => {
  if (agentIds && !agentIds.length) return [];
  const only = agentIds ? ` AND agent_id IN (${agentIds.map(() => "?").join(", ")})` : "";
  return (await q.all<EventRow>(`SELECT * FROM events WHERE at > ?${only} ORDER BY seq DESC LIMIT ?`, ms(since), ...(agentIds ?? []), n)).map(toWire).reverse();
};
export const lastSeq = async (q: Q) => (await q.get<{ seq: number }>("SELECT COALESCE(MAX(seq), 0) AS seq FROM events"))!.seq;

// ---- agent ingestion -------------------------------------------------------------------------

/**
 * What one agent key may put into TEND. Without these, a leaked or looping key can fill the database (every write then fails, and
 * so does every other agent's gateway request) and bury a real approval under thousands of look-alikes. The event log cannot be
 * trimmed afterwards, so the limit has to be at the door. Generous for real use: 600 events a minute is ten a second.
 * An object, not constants, so tests can lower it.
 */
export const QUOTA = { eventsPerMinute: 600, eventsPerDay: 50_000, authorizationsPerDay: 5_000, pendingReviews: 20 };

/** Takes `cost` units of an agent's allowance, or refuses with 429 and says when it frees up. Atomic: parallel callers cannot overspend it. */
export async function agentBudget(q: Q, agentId: string, kind: "events" | "authorizations", cost = 1) {
  const windows: [string, number, number][] = kind === "events"
    ? [["minute", 60_000, QUOTA.eventsPerMinute], ["day", 86_400_000, QUOTA.eventsPerDay]]
    : [["day", 86_400_000, QUOTA.authorizationsPerDay]];
  for (const [name, windowMs, max] of windows) {
    const r = await spend(q, `quota:${kind}:${name}:${agentId}`, max, { windowMs, cost });
    if (!r.ok) throw new HttpError(429, "agent_quota_exceeded", `This agent has used its allowance of ${max} ${kind} per ${name}. Slow down and retry later.`, { quota: `${kind}_per_${name}`, limit: max, retryAfter: r.retryAfter });
  }
}

/** Opens a review for a person. Only a bounded number can wait at once, whatever path they come from; must run in a transaction that holds the event lock. */
async function openReview(q: Q, agentId: string, id: string, permission: string | null = null) {
  const { n } = (await q.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM reviews WHERE agent_id = ? AND status = 'pending'", agentId))!;
  if (n >= QUOTA.pendingReviews) throw new HttpError(429, "too_many_pending_reviews", `At most ${QUOTA.pendingReviews} requests can wait for a person at once. Retry when some are answered.`, { limit: QUOTA.pendingReviews, retryAfter: 60 });
  await q.run("INSERT INTO reviews (id, agent_id, status, permission) VALUES (?, ?, 'pending', ?)", id, agentId, permission);
}

const S = (v: unknown, max: number) => (typeof v === "string" ? cleanText(v).trim().slice(0, max) : "");
const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const PERMISSION = /^[a-z][a-z0-9_.-]*$/;
const OUTCOMES: ToolOutcome[] = ["success", "failure", "denied", "pending_approval", "cancelled"];

/** Validates one agent event. Only whitelisted fields are kept; nothing else reaches storage. */
export function parseAgentEvent(input: unknown): { type: EventType | "agent.heartbeat"; data: Record<string, unknown>; idempotencyKey?: string } {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const d = (o.data && typeof o.data === "object" ? o.data : {}) as Record<string, unknown>;
  const errors: string[] = [];
  const type = o.type as string;
  const idem = o.idempotencyKey == null ? undefined : S(o.idempotencyKey, 64);
  if (o.idempotencyKey != null && (!idem || !ID.test(idem))) errors.push("idempotencyKey must be 1–64 characters of letters, digits, _ . : -");
  let data: Record<string, unknown> = {};
  const taskId = () => {
    const id = S(d.taskId, 64);
    if (!ID.test(id)) errors.push("data.taskId is required (1–64 characters of letters, digits, _ . : -)");
    return id;
  };
  switch (type) {
    case "task.started": {
      const title = S(d.title, 140);
      if (!title) errors.push("data.title is required");
      data = { taskId: taskId(), title, ...(S(d.detail, 500) && { detail: S(d.detail, 500) }) };
      break;
    }
    case "task.completed":
      data = { taskId: taskId(), ...(S(d.summary, 500) && { summary: S(d.summary, 500) }) };
      break;
    case "task.failed":
      data = { taskId: taskId(), ...(S(d.error, 500) && { error: S(d.error, 500) }) };
      break;
    case "tool.called": {
      // Identifiers and outcomes only: never prompts, model output or document contents.
      const tool = S(d.tool, 64), action = S(d.action, 64), outcome = d.outcome as ToolOutcome;
      if (!ID.test(tool)) errors.push("data.tool is required (1–64 characters of letters, digits, _ . : -)");
      if (!ID.test(action)) errors.push("data.action is required (1–64 characters of letters, digits, _ . : -)");
      if (!OUTCOMES.includes(outcome)) errors.push(`data.outcome must be one of ${OUTCOMES.join(", ")}`);
      const opt: Record<string, string> = {};
      for (const k of ["taskId", "resource", "policy", "approvalId", "authorizationId"]) {
        const v = S(d[k], 64);
        if (d[k] != null && !ID.test(v)) errors.push(`data.${k} must be 1–64 characters of letters, digits, _ . : -`);
        if (v) opt[k] = v;
      }
      const permission = S(d.permission, 80);
      if (d.permission != null && !PERMISSION.test(permission)) errors.push("data.permission must look like docs.restricted.read");
      if (d.approval != null && d.approval !== "required") errors.push('data.approval must be "required" when present');
      data = {
        tool, action, outcome, ...opt, ...(permission && { permission }), ...(d.approval === "required" && { approval: "required" }),
        ...(S(d.detail, 200) && { detail: S(d.detail, 200) }), ...(S(d.error, 200) && { error: S(d.error, 200) }),
      };
      break;
    }
    case "agent.idle": case "agent.heartbeat":
      break;
    case "agent.disconnected":
      data = S(d.reason, 200) ? { reason: S(d.reason, 200) } : {};
      break;
    case "review.requested": {
      const reason = S(d.reason, 1000);
      if (!reason) errors.push("data.reason is required");
      data = { reason, ...(d.proposedAdjustment != null && { adjustment: parseAdjustment(d.proposedAdjustment, errors, "data.proposedAdjustment") }) };
      break;
    }
    case "config.acknowledged": {
      const version = Number(d.version);
      if (!Number.isInteger(version) || version < 1) errors.push("data.version must be a positive integer");
      data = { version };
      break;
    }
    default:
      errors.push(`type must be one of task.started, task.completed, task.failed, tool.called, agent.idle, agent.heartbeat, agent.disconnected, review.requested, config.acknowledged (check-ins go to /api/v1/check-ins)`);
  }
  if (errors.length) throw new HttpError(422, "invalid_event", "The event did not validate.", { errors });
  return { type: type as EventType, data, ...(idem && { idempotencyKey: idem }) };
}

/** Event types a paused agent may still send: finishing work, going idle, leaving, confirming config. */
const ALLOWED_WHILE_PAUSED = new Set(["task.completed", "task.failed", "agent.idle", "agent.heartbeat", "agent.disconnected", "config.acknowledged"]);

function guard(agent: Agent, type: string) {
  if (!agent.integrationEnabled) throw new HttpError(403, "integration_disabled", "A human has disabled this agent’s integration.");
  if (agent.status === "paused" && !ALLOWED_WHILE_PAUSED.has(type)) throw new HttpError(409, "agent_paused", "A human has paused this agent. Only completion, idle, disconnect and config acknowledgements are accepted.");
}

const touch = (q: Q, agentId: string, now: number, disconnecting = false) =>
  q.run("UPDATE agents SET last_seen_at = ?, disconnected_at = ? WHERE id = ?", ms(now), disconnecting ? ms(now) : null, agentId);

/** Ingests a batch of agent events atomically. Duplicate idempotency keys are reported, not re-stored. */
export async function ingestEvents(db: DB, agent: Agent, inputs: unknown[]) {
  if (!inputs.length || inputs.length > 50) throw new HttpError(422, "invalid_batch", "Send between 1 and 50 events per request.");
  const parsed = inputs.map(parseAgentEvent);
  for (const p of parsed) guard(agent, p.type);
  // Before the lock is taken, so a flood is refused cheaply. Presence pings store nothing and cost nothing.
  const storable = parsed.filter((p) => p.type !== "agent.heartbeat").length;
  if (storable) await agentBudget(db, agent.id, "events", storable);
  return db.tx(async (q) => {
    // Taken first, so two retries of the same request can't both pass the duplicate check.
    await q.lockEvents();
    const now = Date.now();
    const results: { id?: string; seq?: number; type: string; status: "stored" | "duplicate" | "presence"; alerts?: string[] }[] = [];
    for (const p of parsed) {
      await touch(q, agent.id, now, p.type === "agent.disconnected");
      if (p.type === "agent.heartbeat") {
        results.push({ type: p.type, status: "presence" });
        continue;
      }
      if (p.idempotencyKey) {
        const dup = await q.get<{ id: string; seq: number }>("SELECT id, seq FROM events WHERE agent_id = ? AND idempotency_key = ?", agent.id, p.idempotencyKey);
        if (dup) {
          results.push({ ...dup, type: p.type, status: "duplicate" });
          continue;
        }
      }
      if (p.type === "config.acknowledged") {
        const v = Number(p.data.version);
        if (v > agent.configVersion) throw new HttpError(422, "invalid_event", `Configuration v${v} doesn’t exist yet; the current version is v${agent.configVersion}.`);
        await q.run("UPDATE agents SET acked_version = GREATEST(acked_version, ?) WHERE id = ?", v, agent.id);
      }
      const e = await insertEvent(q, { agentId: agent.id, type: p.type as EventType, actor: "agent", data: p.data, at: now, idempotencyKey: p.idempotencyKey });
      if (p.type === "review.requested") await openReview(q, agent.id, e.id, (p.data.adjustment as { permission?: string })?.permission ?? null);
      const alerts = p.type === "tool.called" ? await inspectTool(q, agent, e.id, p.data, now) : [];
      results.push({ id: e.id, seq: e.seq, type: p.type, status: "stored", ...(alerts.length && { alerts }) });
    }
    return results;
  });
}

export const REPEAT = { failures: 3, windowMs: 5 * 60_000 };

/**
 * Tend's own checks on a reported tool call, independent of what the agent's runtime concluded.
 * Raises `alert.raised` events (actor "system") and opens a review when an action needs approval.
 */
async function inspectTool(q: Q, agent: Agent, eventId: string, d: Record<string, unknown>, now: number) {
  const alerts: string[] = [];
  const raise = async (kind: string, data: object) => {
    alerts.push(kind);
    await insertEvent(q, { agentId: agent.id, type: "alert.raised", actor: "system", at: now, data: { kind, eventId, tool: d.tool, action: d.action, outcome: d.outcome, ...(d.resource ? { resource: d.resource } : {}), ...data } });
  };
  const permission = d.permission as string | undefined;
  const lacks = !!permission && !agent.permissions.includes(permission);
  // Tried something its granted permissions don't cover, or the runtime refused it on policy grounds.
  if ((lacks && d.outcome !== "pending_approval") || (d.outcome === "denied" && d.policy))
    await raise("policy_violation", { policy: d.policy ?? "missing_permission", ...(permission && { permission }), blocked: d.outcome !== "success" });
  if (d.outcome === "pending_approval") await openReview(q, agent.id, eventId);
  // The runtime gave up waiting: take the request out of the queue so nobody approves an action that won't run.
  if (d.outcome === "cancelled" && d.approvalId
    && await q.run("UPDATE reviews SET status = 'withdrawn', decided_at = ? WHERE id = ? AND agent_id = ? AND status = 'pending'", ms(now), d.approvalId, agent.id))
    await insertEvent(q, { agentId: agent.id, type: "review.withdrawn", actor: "system", at: now, data: { reviewId: d.approvalId, eventId, ...(d.error ? { reason: d.error } : {}) } });
  if (d.outcome === "success" && d.approval === "required") {
    const id = d.approvalId as string | undefined;
    // The approval must be one this agent's runtime held for exactly this tool, resource and detail,
    // not just any approved review. `action` differs by design: "create" asks, "execute" runs.
    const held = id ? await q.get<{ status: string; data: string }>(
      "SELECT r.status, e.data FROM reviews r JOIN events e ON e.id = r.id WHERE r.id = ? AND r.agent_id = ? AND e.type = 'tool.called' AND (e.data::jsonb)->>'outcome' = 'pending_approval'", id, agent.id) : undefined;
    const asked = held ? (JSON.parse(held.data) as Record<string, unknown>) : undefined;
    const matches = !!asked && (["tool", "resource", "detail"] as const).every((k) => (asked[k] ?? null) === (d[k] ?? null));
    // One approval covers one execution: count executions after the decision (by seq, not clock).
    const reused = held?.status === "approved" && matches && (await q.get<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM events WHERE agent_id = ? AND type = 'tool.called' AND (data::jsonb)->>'approvalId' = ? AND (data::jsonb)->>'outcome' = 'success'
         AND seq > (SELECT MAX(seq) FROM events WHERE type = 'review.decided' AND (data::jsonb)->>'reviewId' = ?)`, agent.id, id, id))!.n > 1;
    const reason = !id ? "no_approval" : held?.status !== "approved" ? "not_approved" : !matches ? "approval_mismatch" : reused ? "approval_reused" : undefined;
    if (reason) await raise("unapproved_execution", { reason, ...(id && { approvalId: id }) });
  }
  // An execution reported against an authorization must match one this agent consumed, exactly, and only once.
  // An execution of a policy-governed tool with no authorization at all is flagged when the agent is in enforce mode.
  if (d.outcome === "success" || d.outcome === "failure") {
    const azId = d.authorizationId as string | undefined;
    if (azId) {
      const az = await q.get<{ status: string; tool: string; action: string; resource: string | null; detail: string | null }>(
        "SELECT status, tool, action, resource, detail FROM authorizations WHERE id = ? AND agent_id = ?", azId, agent.id);
      const matches = !!az && (["tool", "action", "resource", "detail"] as const).every((k) => (az[k] ?? null) === (d[k] ?? null));
      // Earlier executions reported after it was consumed (by seq, not clock). A report from before consumption was flagged on its own.
      const twice = (await q.get<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM events WHERE agent_id = ? AND type = 'tool.called' AND id <> ? AND (data::jsonb)->>'authorizationId' = ? AND (data::jsonb)->>'outcome' IN ('success', 'failure')
           AND seq > (SELECT MIN(seq) FROM events WHERE agent_id = ? AND type = 'authorization.consumed' AND (data::jsonb)->>'authorizationId' = ?)`,
        agent.id, eventId, azId, agent.id, azId))!.n > 0;
      const reason = !az ? "unknown_authorization" : az.status !== "consumed" ? "not_consumed" : !matches ? "execution_differs" : twice ? "executed_twice" : undefined;
      if (reason) await raise(reason === "executed_twice" ? "authorization_replay" : "authorization_mismatch", { authorizationId: azId, reason });
    } else {
      const a = await agentRow(q, agent.id);
      const central = a ? await centralOf(q, a) : undefined;
      // An unreadable policy counts as governing everything: detection fails closed too. A central policy governs as well.
      const governs = (raw: unknown) => {
        const rules = parsePolicy(raw);
        return !rules.ok || rules.rules.some((r) => r.tool === d.tool && (r.action === "*" || r.action === d.action)
          && (r.resourcePrefix === undefined || (typeof d.resource === "string" && d.resource.startsWith(r.resourcePrefix))));
      };
      const governed = !a || governs(a.policy) || (central !== undefined && governs(central.policy));
      if (a?.enforcement === "enforce" && governed) await raise("unauthorized_execution", { reason: "no_authorization" });
    }
  }
  if (d.outcome === "failure") {
    const since = now - REPEAT.windowMs;
    const { n } = (await q.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM events WHERE agent_id = ? AND type = 'tool.called' AND at > ? AND (data::jsonb)->>'tool' = ? AND (data::jsonb)->>'outcome' = 'failure'", agent.id, since, d.tool))!;
    const already = await q.get("SELECT 1 FROM events WHERE agent_id = ? AND type = 'alert.raised' AND at > ? AND (data::jsonb)->>'kind' = 'repeated_failures' AND (data::jsonb)->>'tool' = ?", agent.id, since, d.tool);
    if (n >= REPEAT.failures && !already) await raise("repeated_failures", { count: n, windowMinutes: REPEAT.windowMs / 60_000 });
  }
  return alerts;
}

/** Stores a check-in. Used by connected agents (actor "agent") and by operators composing for demo agents ("human"). */
export async function ingestCheckIn(db: DB, agent: Agent, body: unknown, actor: Actor) {
  const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (o.agentId != null && o.agentId !== agent.id) throw new HttpError(403, "agent_mismatch", "agentId doesn’t match the authenticated agent. Omit it; the key identifies the agent.");
  const parsed = parseCheckIn({ ...o, agentId: agent.id });
  if (!parsed.ok) throw new HttpError(422, "invalid_check_in", "The check-in did not validate.", { errors: parsed.errors });
  guard(agent, "check_in");
  const v = parsed.value;
  if (actor === "agent") await agentBudget(db, agent.id, "events"); // an operator composing for a demo agent is not an agent's key
  return db.tx(async (q) => {
    await q.lockEvents();
    const now = Date.now();
    if (actor === "agent") await touch(q, agent.id, now);
    const e = await insertEvent(q, {
      agentId: agent.id, type: "check_in", actor, at: now,
      data: { responses: v.responses, feedback: v.feedback, context: v.context, ...(v.reflection && { reflection: v.reflection }), ...(v.proposedAdjustment && { adjustment: v.proposedAdjustment }) },
    });
    const review = needsReview(v);
    if (review) await (actor === "agent" ? openReview(q, agent.id, e.id, v.proposedAdjustment?.permission ?? null) : q.run("INSERT INTO reviews (id, agent_id, status, permission) VALUES (?, ?, 'pending', ?)", e.id, agent.id, v.proposedAdjustment?.permission ?? null));
    await q.run("UPDATE asks SET answered_at = ? WHERE agent_id = ? AND answered_at IS NULL", ms(now), agent.id);
    return { id: e.id, seq: e.seq, requiresReview: review };
  });
}

/** What a connected agent should know: its current configuration and any human requests. */
export async function inbox(db: DB, agent: Agent) {
  return db.tx(async (q) => {
    await q.lockEvents();
    const now = Date.now();
    await touch(q, agent.id, now);
    const open = await q.all<{ id: string; requested_at: number; delivered_at: number | null }>("SELECT id, requested_at, delivered_at FROM asks WHERE agent_id = ? AND answered_at IS NULL ORDER BY requested_at", agent.id);
    for (const a of open)
      if (!a.delivered_at) {
        await q.run("UPDATE asks SET delivered_at = ? WHERE id = ?", ms(now), a.id);
        await insertEvent(q, { agentId: agent.id, type: "checkin.request.delivered", actor: "system", data: { askId: a.id }, at: now });
      }
    // Human decisions on actions this agent held for approval in the last day.
    const approvals = await q.all<{ id: string; status: string }>(
      "SELECT r.id, r.status FROM reviews r JOIN events e ON e.id = r.id WHERE r.agent_id = ? AND e.type = 'tool.called' AND e.at > ? ORDER BY e.seq", agent.id, ms(now - 86_400_000));
    // "enforce": the agent's runtime must route policy-governed tools through pre-execution authorization.
    const enforcement = (await agentRow(q, agent.id))?.enforcement ?? "enforce";
    return {
      config: { version: agent.configVersion, status: agent.status, integrationEnabled: agent.integrationEnabled, permissions: agent.permissions, enforcement },
      requests: open.map((a) => ({ id: a.id, type: "check_in", requestedAt: new Date(a.requested_at).toISOString() })),
      approvals,
    };
  });
}

// ---- human actions ---------------------------------------------------------------------------

/** Reads an agent and locks its row for the rest of the transaction. */
async function mustAgent(q: Q, id: string) {
  const r = await q.get<AgentRow>("SELECT * FROM agents WHERE id = ? FOR UPDATE", id);
  if (!r) throw new HttpError(404, "agent_not_found", `No agent with id “${id}”.`);
  return toAgent(r);
}

const bump = async (q: Q, id: string) => (await q.get<{ config_version: number }>("UPDATE agents SET config_version = config_version + 1 WHERE id = ? RETURNING config_version", id))!.config_version;

export async function control(db: DB, agentId: string, action: "pause" | "resume" | "disable" | "enable", note?: string, by?: string) {
  return db.tx(async (q) => {
    await q.lockEvents();
    const a = await mustAgent(q, agentId);
    const plan = {
      pause: { when: a.status !== "paused", sql: "UPDATE agents SET status = 'paused' WHERE id = ?", type: "agent.paused" },
      resume: { when: a.status === "paused", sql: "UPDATE agents SET status = 'active' WHERE id = ?", type: "agent.resumed" },
      disable: { when: a.integrationEnabled, sql: "UPDATE agents SET integration_enabled = 0 WHERE id = ?", type: "integration.disabled" },
      enable: { when: !a.integrationEnabled, sql: "UPDATE agents SET integration_enabled = 1 WHERE id = ?", type: "integration.enabled" },
    }[action];
    if (!plan) throw new HttpError(422, "invalid_action", "action must be pause, resume, disable or enable.");
    if (!plan.when) throw new HttpError(409, "no_change", `${a.name} is already ${action === "pause" ? "paused" : action === "resume" ? "running" : action === "disable" ? "disabled" : "enabled"}.`);
    await q.run(plan.sql, agentId);
    const version = await bump(q, agentId);
    if (action === "pause" || action === "disable") await q.run("DELETE FROM meta WHERE key = ?", `demo.task.${agentId}`);
    return insertEvent(q, { agentId, type: plan.type as EventType, actor: "human", data: { version, ...(note && { note: note.slice(0, 500) }), ...(by && { by }) } });
  });
}

/** Replaces an agent's policy (and optionally its enforcement mode). A policy that doesn't validate is refused whole, never half applied. */
/** The checks every policy change goes through, whether for one agent or several. Throws; returns the parsed rules. */
function checkedPolicy(rules: unknown, enforcement?: unknown, expectedVersion?: unknown) {
  const parsed = parsePolicy(rules);
  if (!parsed.ok) throw new HttpError(422, "invalid_policy", parsed.error);
  const problem = policyProblem(parsed.rules);
  if (problem) throw new HttpError(422, "spend_requires_approval", problem);
  if (expectedVersion !== undefined && !Number.isInteger(expectedVersion)) throw new HttpError(422, "invalid_version", "expectedVersion must be an integer.");
  if (enforcement !== undefined && enforcement !== "monitor" && enforcement !== "enforce") throw new HttpError(422, "invalid_enforcement", "enforcement must be monitor or enforce.");
  return parsed.rules;
}

/** Writes the rules, bumps the version and records the change. Caller holds the events lock and the agent row lock. */
async function applyPolicy(q: Q, agentId: string, rules: ReturnType<typeof checkedPolicy>, enforcement: unknown, by?: string, central?: number) {
  await q.run("UPDATE agents SET policy = ? WHERE id = ?", JSON.stringify(rules), agentId);
  if (enforcement) await q.run("UPDATE agents SET enforcement = ? WHERE id = ?", enforcement as string, agentId);
  // `policy` is the full rule set that took effect, so what was allowed at any moment can be read back from the log.
  return insertEvent(q, { agentId, type: "policy.updated", actor: "human", data: { version: await bump(q, agentId), rules: rules.length, policy: rules, ...(enforcement ? { enforcement } : {}), ...(by ? { by } : {}), ...(central ? { central } : {}) } });
}

export async function setPolicy(db: DB, agentId: string, rules: unknown, enforcement?: unknown, by?: string, expectedVersion?: unknown) {
  const checked = checkedPolicy(rules, enforcement, expectedVersion);
  return db.tx(async (q) => {
    await q.lockEvents();
    const current = await mustAgent(q, agentId);
    // The caller edited a view of version N; if the rules moved on since, saving would silently undo someone else's change.
    if (expectedVersion !== undefined && current.configVersion !== expectedVersion)
      throw new HttpError(409, "policy_changed", "This agent’s rules changed since you opened them. Reload and try again.", { version: current.configVersion });
    return applyPolicy(q, agentId, checked, enforcement, by);
  });
}

// ---- central policies ----------------------------------------------------------------------------------------------------------------

interface CentralRow { id: string; name: string; policy: string; version: number; created_at: number; updated_at: number; updated_by: string | null; workspace_id: string }
const NAME = /^[^\u0000-\u001f\u007f]{1,64}$/;

/** The central policy an agent is assigned to, read in the caller's transaction. `policy: null` (a dangling id) denies everything. */
export async function centralOf(q: Q, a: Pick<AgentRow, "central_policy_id">): Promise<{ id: string; version: number; policy: string | null } | undefined> {
  if (!a.central_policy_id) return undefined;
  const c = await q.get<CentralRow>("SELECT * FROM central_policies WHERE id = ?", a.central_policy_id);
  return { id: a.central_policy_id, version: c?.version ?? 0, policy: c?.policy ?? null };
}

const centralView = async (q: Q, c: CentralRow) => ({
  id: c.id, name: c.name, version: c.version, rules: JSON.parse(c.policy), createdAt: c.created_at, updatedAt: c.updated_at,
  agents: (await q.all<{ id: string }>("SELECT id FROM agents WHERE central_policy_id = ? ORDER BY id", c.id)).map((r) => r.id),
});
async function mustCentral(q: Q, id: string, lock = false) {
  const c = await q.get<CentralRow>(`SELECT * FROM central_policies WHERE id = ?${lock ? " FOR UPDATE" : ""}`, id);
  if (!c) throw new HttpError(404, "central_policy_not_found", `No central policy with id “${id}”.`);
  return c;
}
const agentList = (v: unknown, field: string) => {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 50 || v.some((x) => typeof x !== "string") || new Set(v).size !== v.length)
    throw new HttpError(422, "invalid_agents", `${field} must be a list of up to 50 distinct agent ids.`);
  return [...(v as string[])].sort(); // a fixed lock order, so two changes cannot deadlock
};

export async function listCentralPolicies(q: Q, workspace = DEFAULT_WORKSPACE) {
  return Promise.all((await q.all<CentralRow>("SELECT * FROM central_policies WHERE workspace_id = ? ORDER BY name", workspace)).map((c) => centralView(q, c)));
}

/** A new central policy, assigned to nobody yet. Same validation as an agent's own policy. Operator only (the route checks). */
export async function createCentralPolicy(db: DB, body: unknown, by?: string, workspace = DEFAULT_WORKSPACE) {
  const { name, rules } = (body ?? {}) as { name?: unknown; rules?: unknown };
  if (typeof name !== "string" || !NAME.test(name.trim())) throw new HttpError(422, "invalid_name", "name must be 1–64 printable characters.");
  const checked = checkedPolicy(rules);
  return db.tx(async (q) => {
    await q.lockEvents();
    if (await q.get("SELECT 1 FROM central_policies WHERE name = ? AND workspace_id = ?", name.trim(), workspace)) throw new HttpError(409, "name_taken", "A central policy with that name already exists.");
    const id = `cp_${randomUUID().replaceAll("-", "").slice(0, 20)}`, now = Date.now();
    await q.run("INSERT INTO central_policies (id, name, policy, version, created_at, updated_at, updated_by, workspace_id) VALUES (?, ?, ?, 1, ?, ?, ?, ?)", id, name.trim(), JSON.stringify(checked), now, now, by ?? null, workspace);
    return centralView(q, (await mustCentral(q, id))!);
  });
}

/**
 * Changes a central policy. Every assigned agent is governed by the new rules from the moment this commits (requests, token claims and
 * consumes all read it under the same lock), and each gets a `policy.central_updated` event carrying the full rule set and `by`.
 */
export async function updateCentralPolicy(db: DB, id: string, body: unknown, by?: string) {
  const { rules, expectedVersion } = (body ?? {}) as { rules?: unknown; expectedVersion?: unknown };
  const checked = checkedPolicy(rules, undefined, expectedVersion);
  return db.tx(async (q) => {
    await q.lockEvents();
    const c = await mustCentral(q, id, true);
    if (expectedVersion !== undefined && c.version !== expectedVersion)
      throw new HttpError(409, "policy_changed", "This central policy changed since you opened it. Reload and try again.", { version: c.version });
    const now = Date.now(), version = c.version + 1;
    await q.run("UPDATE central_policies SET policy = ?, version = ?, updated_at = ?, updated_by = ? WHERE id = ?", JSON.stringify(checked), version, now, by ?? null, id);
    for (const { id: agentId } of await q.all<{ id: string }>("SELECT id FROM agents WHERE central_policy_id = ? ORDER BY id FOR UPDATE", id))
      await insertEvent(q, { agentId, type: "policy.central_updated", actor: "human", at: now, data: { version: await bump(q, agentId), policyId: id, name: c.name, policyVersion: version, policy: checked, ...(by ? { by } : {}) } });
    return centralView(q, (await mustCentral(q, id))!);
  });
}

/**
 * Assigns this central policy to agents and/or removes it from them: { assign: [ids], unassign: [ids] }. All or nothing; an agent can
 * hold one central policy, so assigning moves it from any other (the event names the previous one). Each change is an audit event.
 */
export async function assignCentralPolicy(db: DB, id: string, body: unknown, by?: string) {
  const { assign, unassign } = (body ?? {}) as { assign?: unknown; unassign?: unknown };
  const add = agentList(assign, "assign"), remove = agentList(unassign, "unassign");
  if (!add.length && !remove.length) throw new HttpError(422, "invalid_agents", "Give at least one agent id in assign or unassign.");
  if (add.some((x) => remove.includes(x))) throw new HttpError(422, "invalid_agents", "An agent cannot be assigned and unassigned at once.");
  return db.tx(async (q) => {
    await q.lockEvents();
    const c = await mustCentral(q, id, true);
    const now = Date.now(), rules = JSON.parse(c.policy);
    for (const agentId of add) {
      const row = (await q.get<AgentRow>("SELECT * FROM agents WHERE id = ? FOR UPDATE", agentId));
      if (!row || row.workspace_id !== c.workspace_id) throw new HttpError(404, "agent_not_found", `No agent with id “${agentId}”.`);
      if (row.central_policy_id === id) continue;
      await q.run("UPDATE agents SET central_policy_id = ? WHERE id = ?", id, agentId);
      await insertEvent(q, { agentId, type: "policy.central_assigned", actor: "human", at: now, data: { version: await bump(q, agentId), policyId: id, name: c.name, policyVersion: c.version, policy: rules, ...(row.central_policy_id ? { previous: row.central_policy_id } : {}), ...(by ? { by } : {}) } });
    }
    for (const agentId of remove) {
      const row = (await q.get<AgentRow>("SELECT * FROM agents WHERE id = ? FOR UPDATE", agentId));
      if (!row || row.workspace_id !== c.workspace_id) throw new HttpError(404, "agent_not_found", `No agent with id “${agentId}”.`);
      if (row.central_policy_id !== id) throw new HttpError(409, "not_assigned", `Agent “${agentId}” is not assigned to this central policy.`);
      await q.run("UPDATE agents SET central_policy_id = NULL WHERE id = ?", agentId);
      await insertEvent(q, { agentId, type: "policy.central_unassigned", actor: "human", at: now, data: { version: await bump(q, agentId), policyId: id, name: c.name, ...(by ? { by } : {}) } });
    }
    return centralView(q, c);
  });
}

export async function decide(db: DB, reviewId: string, status: "approved" | "rejected" | "acknowledged", note?: string, by?: string) {
  if (!["approved", "rejected", "acknowledged"].includes(status)) throw new HttpError(422, "invalid_status", "status must be approved, rejected or acknowledged.");
  // Outside the transaction, so an expiry is kept even though the decision below is refused.
  await sweepExpired(db, Date.now());
  return db.tx(async (q) => {
    await q.lockEvents();
    // Locked, so two reviewers deciding at once can't both grant.
    const r = await q.get<{ id: string; agent_id: string; status: string; permission: string | null }>("SELECT * FROM reviews WHERE id = ? FOR UPDATE", reviewId);
    if (!r) throw new HttpError(404, "review_not_found", "No review with that id.");
    if (r.status !== "pending") throw new HttpError(409, "already_decided", `This review was already ${r.status}.`);
    const now = Date.now();
    // A review that is an authorization request also decides that authorization, if it hasn't expired.
    const authz = !!(await q.get("SELECT 1 FROM authorizations WHERE id = ?", reviewId));
    if (authz) {
      if (status === "acknowledged") throw new HttpError(422, "invalid_status", "Authorization requests can only be approved or rejected.");
      if (!(await q.run("UPDATE authorizations SET status = ?, decided_at = ?, approved_until = ? WHERE id = ? AND status = 'pending' AND expires_at > ?",
        status, ms(now), status === "approved" ? ms(now + TTL.approval) : null, reviewId, ms(now))))
        throw new HttpError(409, "expired", "This request is no longer waiting for a decision.");
    }
    await q.run("UPDATE reviews SET status = ?, decided_at = ? WHERE id = ?", status, ms(now), reviewId);
    const events = [await insertEvent(q, { agentId: r.agent_id, type: "review.decided", actor: "human", at: now, data: {
      reviewId, status, ...(note && { note: note.slice(0, 500) }), ...(by && { by }),
      ...(authz && { authorizationId: reviewId, ...(status === "approved" && { expiresAt: ms(now + TTL.approval) }) }),
    } })];
    if (status === "approved" && r.permission) {
      const a = await mustAgent(q, r.agent_id);
      if (!a.permissions.includes(r.permission)) await q.run("UPDATE agents SET permissions = ? WHERE id = ?", JSON.stringify([...a.permissions, r.permission]), a.id);
      events.push(await insertEvent(q, { agentId: a.id, type: "permission.granted", actor: "human", at: now, data: { permission: r.permission, reviewId, version: await bump(q, a.id) } }));
    }
    return events;
  });
}

export async function requestCheckIn(db: DB, agentId: string, by?: string) {
  return db.tx(async (q) => {
    await q.lockEvents();
    const a = await mustAgent(q, agentId);
    if (!a.integrationEnabled || a.status === "paused") throw new HttpError(409, "agent_unavailable", `${a.name} can’t submit check-ins while paused or disabled.`);
    if (await q.get("SELECT 1 FROM asks WHERE agent_id = ? AND answered_at IS NULL", agentId)) throw new HttpError(409, "already_requested", `A check-in from ${a.name} is already requested.`);
    const now = Date.now();
    const askId = `ask_${randomUUID().slice(0, 8)}`;
    await q.run("INSERT INTO asks (id, agent_id, requested_at) VALUES (?, ?, ?)", askId, agentId, ms(now));
    return insertEvent(q, { agentId, type: "checkin.requested", actor: "human", at: now, data: { askId, ...(by && { by }) } });
  });
}

const PROVIDERS: Provider[] = ["Anthropic", "OpenAI", "Google", "Custom"];

export async function registerAgent(db: DB, input: unknown, by?: string, workspace = DEFAULT_WORKSPACE) {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const name = S(o.name, 40), model = S(o.model, 60), provider = o.provider as Provider;
  const errors: string[] = [];
  if (!name) errors.push("name is required");
  if (!model) errors.push("model is required");
  if (!PROVIDERS.includes(provider)) errors.push(`provider must be one of ${PROVIDERS.join(", ")}`);
  if (errors.length) throw new HttpError(422, "invalid_agent", "The agent did not validate.", { errors });
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agent";
  const k = newKey();
  const now = Date.now();
  return db.tx(async (q) => {
    await q.lockEvents();
    // Ids are global. In a user's workspace a random suffix keeps them from saying whether another workspace already has the name.
    let id = workspace === DEFAULT_WORKSPACE ? base : `${base}-${randomBytes(3).toString("hex")}`;
    for (let i = 2; await agentRow(q, id); i++) id = workspace === DEFAULT_WORKSPACE ? `${base}-${i}` : `${base}-${randomBytes(3).toString("hex")}`;
    const agent: Agent = {
      id, name, model, provider, role: S(o.role, 60) || "Connected agent", description: S(o.description, 300), status: "active",
      integrationEnabled: true, permissions: [], cadenceHours: 0, connectedAt: now, origin: "connected", configVersion: 1, ackedVersion: 0, public: o.public === true,
    };
    await insertAgent(q, agent, k.hash, k.prefix, workspace);
    await insertEvent(q, { agentId: id, type: "agent.registered", actor: "human", at: now, data: { agent, ...(by && { by }) } });
    return { agent, apiKey: k.key };
  });
}

/**
 * What an old key could still set in motion: requests nobody has answered and approvals not yet used. Both end with the key, so
 * whoever holds the next key (or a stolen one, if the person who revoked it was right to worry) cannot pick up what the old key started.
 * Spent authorizations are history and stay as they are.
 */
async function endOutstanding(q: Q, agentId: string, now: number, by?: string) {
  const rows = await q.all<{ id: string }>("UPDATE authorizations SET status = 'cancelled', token_hash = NULL WHERE agent_id = ? AND status IN ('pending', 'approved') RETURNING id", agentId);
  for (const { id } of rows) {
    if (await q.run("UPDATE reviews SET status = 'withdrawn', decided_at = ? WHERE id = ? AND status = 'pending'", ms(now), id))
      await insertEvent(q, { agentId, type: "review.withdrawn", actor: "system", at: now, data: { reviewId: id, reason: "key revoked" } });
    await insertEvent(q, { agentId, type: "authorization.cancelled", actor: "human", at: now, data: { authorizationId: id, reason: "key_revoked", ...(by && { by }) } });
  }
  return rows.length;
}

export async function rotateKey(db: DB, agentId: string, by?: string) {
  const k = newKey();
  return db.tx(async (q) => {
    await q.lockEvents();
    const a = await mustAgent(q, agentId);
    if (a.origin !== "connected") throw new HttpError(409, "not_connected", "Demo agents don’t have API keys.");
    await q.run("UPDATE agents SET key_hash = ?, key_prefix = ? WHERE id = ?", k.hash, k.prefix, agentId);
    await endOutstanding(q, agentId, Date.now(), by);
    await insertEvent(q, { agentId, type: "key.rotated", actor: "human", data: { prefix: k.prefix, ...(by && { by }) } });
    return { apiKey: k.key, prefix: k.prefix };
  });
}

/**
 * Takes an agent's key away and issues nothing in its place: from the next request on, the agent cannot authenticate at all,
 * and what it had waiting is cancelled. Repeating it changes nothing and records nothing. Rotating the key gives access back.
 */
export async function revokeKey(db: DB, agentId: string, by?: string) {
  return db.tx(async (q) => {
    await q.lockEvents();
    const a = await mustAgent(q, agentId);
    if (a.origin !== "connected") throw new HttpError(409, "not_connected", "Demo agents don’t have API keys.");
    if (!(await q.run("UPDATE agents SET key_hash = NULL, key_prefix = NULL WHERE id = ? AND key_hash IS NOT NULL", agentId))) return { revoked: false as const, cancelled: 0 };
    const now = Date.now();
    const cancelled = await endOutstanding(q, agentId, now, by);
    await insertEvent(q, { agentId, type: "key.revoked", actor: "human", at: now, data: { cancelled, ...(by && { by }) } });
    return { revoked: true as const, cancelled };
  });
}

export const keyPrefixes = async (q: Q, workspace = DEFAULT_WORKSPACE) =>
  Object.fromEntries((await q.all<{ id: string; key_prefix: string }>("SELECT id, key_prefix FROM agents WHERE key_prefix IS NOT NULL AND workspace_id = ?", workspace)).map((r) => [r.id, r.key_prefix]));
