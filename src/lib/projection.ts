// The event log is the source of truth. This reducer turns events into the state the UI reads.
// The server uses it to build snapshots and the browser uses it to apply new events, so they agree.
import { needsReview } from "./contract.ts";
import type { RuleLike } from "./permissions";
import type { Adjustment, Agent, Ask, Authorization, AuthorizationStatus, CheckIn, LogEntry, LogType, QuestionId, QuestionResponse, ReviewRequest, ReviewStatus, Task, TaskEvent, ToolOutcome } from "./types";

export const AGENT_EVENT_TYPES = ["task.started", "task.completed", "task.failed", "tool.called", "agent.idle", "agent.disconnected", "review.requested", "config.acknowledged"] as const;
export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];
export type EventType =
  | AgentEventType
  | "check_in"
  | "review.decided" | "permission.granted"
  | "agent.paused" | "agent.resumed" | "integration.disabled" | "integration.enabled"
  | "checkin.requested" | "checkin.request.delivered"
  | "agent.registered" | "key.rotated" | "key.revoked"
  | "alert.raised" | "review.withdrawn"
  | "policy.updated" | "policy.central_updated" | "policy.central_assigned" | "policy.central_unassigned" | "verification.run"
  | "authorization.requested" | "authorization.denied" | "authorization.consumed" | "authorization.expired" | "authorization.cancelled";

export type Actor = "agent" | "human" | "simulation" | "system";

export interface WireEvent {
  seq: number;
  id: string;
  agentId: string;
  type: EventType;
  at: number;
  actor: Actor;
  data: Record<string, unknown>;
}

export interface Projection {
  agents: Agent[];
  checkIns: CheckIn[];
  log: LogEntry[];
  tasks: Record<string, Task>;
  taskEvents: TaskEvent[];
  requests: ReviewRequest[];
  asks: Record<string, Ask>;
  authorizations: Authorization[];
}

export const emptyProjection = (agents: Agent[] = []): Projection => ({ agents, checkIns: [], log: [], tasks: {}, taskEvents: [], requests: [], asks: {}, authorizations: [] });

const LIMIT = { checkIns: 1500, log: 600, taskEvents: 500, requests: 300, authorizations: 300 };

const source = (a: Actor): CheckIn["source"] => (a === "simulation" ? "simulated" : a === "agent" ? "agent" : "manual");
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
/** A recorded policy rule, kept only if it has the shape of one. */
const ruleOf = (v: unknown): RuleLike | undefined => {
  const r = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  if (!r || typeof r.tool !== "string" || typeof r.action !== "string" || !["allow", "approve", "deny"].includes(r.effect as string)) return undefined;
  return { tool: r.tool, action: r.action, effect: r.effect as RuleLike["effect"], ...(typeof r.resourcePrefix === "string" && { resourcePrefix: r.resourcePrefix }), ...(typeof r.when === "object" && r.when !== null && { when: r.when as Record<string, unknown> }) };
};

/** Applies events (in seq order) and returns a new projection. Arrays are copied once per call. */
export function applyEvents(p: Projection, events: WireEvent[]): Projection {
  if (!events.length) return p;
  const agents = p.agents.slice();
  const tasks = { ...p.tasks };
  const asks = { ...p.asks };
  const oldCheckIns = p.checkIns.slice(), oldRequests = p.requests.slice(), oldAuths = (p.authorizations ?? []).slice();
  const freshCheckIns: CheckIn[] = [], freshRequests: ReviewRequest[] = [], freshLog: LogEntry[] = [], freshTasks: TaskEvent[] = [], freshAuths: Authorization[] = [];
  const known = new Set<string>([...p.log.map((l) => l.id), ...p.checkIns.slice(0, 50).map((c) => c.id)]);

  const agentAt = (id: string) => agents.findIndex((a) => a.id === id);
  const name = (id: string) => agents[agentAt(id)]?.name ?? id;
  const patchAgent = (id: string, patch: Partial<Agent>) => {
    const i = agentAt(id);
    if (i >= 0) agents[i] = { ...agents[i], ...patch };
  };
  const log = (e: WireEvent, type: LogType, summary: string, extra?: Partial<LogEntry>) =>
    freshLog.push({ id: e.id, at: e.at, agentId: e.agentId, actor: e.actor === "agent" ? "agent" : e.actor === "human" ? "human" : "system", type, summary, ...extra });
  // Reviews can target a check-in or a standalone request, fresh or already known.
  const findReview = (id: string): { list: (CheckIn | ReviewRequest)[]; i: number } | null => {
    for (const list of [freshCheckIns, oldCheckIns, freshRequests, oldRequests] as (CheckIn | ReviewRequest)[][]) {
      const i = list.findIndex((x) => x.id === id);
      if (i >= 0) return { list, i };
    }
    return null;
  };
  /** Updates an authorization in place, wherever it is. Returns it (after the patch), or undefined if unknown. */
  const patchAuth = (id: string, patch: (a: Authorization) => Partial<Authorization>) => {
    for (const list of [freshAuths, oldAuths]) {
      const i = list.findIndex((x) => x.id === id);
      if (i >= 0) return (list[i] = { ...list[i], ...patch(list[i]) });
    }
  };
  const authArgs = (d: Record<string, unknown>) => ({ tool: str(d.tool), action: str(d.action), resource: str(d.resource), reason: str(d.reason), rule: ruleOf(d.rule) });

  for (const e of events) {
    if (known.has(e.id)) continue;
    known.add(e.id);
    const d = e.data;
    if (e.actor === "agent") patchAgent(e.agentId, { lastSeenAt: e.at, ...(e.type !== "agent.disconnected" && { disconnectedAt: undefined }) });
    switch (e.type) {
      case "check_in": {
        const payload = { responses: d.responses as Record<QuestionId, QuestionResponse>, proposedAdjustment: d.adjustment as Adjustment | undefined };
        const review = d.review as CheckIn["review"] | undefined;
        freshCheckIns.push({
          id: e.id, agentId: e.agentId, createdAt: e.at, source: source(e.actor),
          responses: payload.responses, feedback: str(d.feedback) ?? "", context: str(d.context) ?? "",
          ...(str(d.reflection) && { reflection: str(d.reflection) }),
          ...(payload.proposedAdjustment && { adjustment: payload.proposedAdjustment }),
          ...(review ? { review } : needsReview(payload) ? { review: { status: "pending" as const } } : {}),
        });
        delete asks[e.agentId];
        break;
      }
      case "review.requested":
        freshRequests.push({
          id: e.id, agentId: e.agentId, createdAt: e.at, reason: str(d.reason) ?? "", source: source(e.actor),
          ...(d.adjustment ? { adjustment: d.adjustment as Adjustment } : {}), review: { status: "pending" },
        });
        break;
      case "authorization.requested": case "authorization.denied": {
        const id = str(d.authorizationId) ?? e.id;
        const status: AuthorizationStatus = e.type === "authorization.denied" ? "denied" : d.status === "approved" ? "approved" : "pending";
        freshAuths.push({
          id, agentId: e.agentId, tool: str(d.tool) ?? "", action: str(d.action) ?? "", status, createdAt: e.at, alerts: 0,
          ...(str(d.resource) && { resource: str(d.resource) }), ...(str(d.detail) && { detail: str(d.detail) }), ...(str(d.exact) && { exact: str(d.exact) }), ...(str(d.reason) && { reason: str(d.reason) }), ...(ruleOf(d.rule) && { rule: ruleOf(d.rule) }),
          ...(Number(d.expiresAt) && status !== "denied" && { expiresAt: Number(d.expiresAt) }), ...(status !== "pending" && { decidedAt: e.at }),
        });
        const a = authArgs(d);
        log(e, status === "denied" ? "authorization_denied" : "authorization_requested", `${name(e.agentId)} asked to run ${a.tool} · ${a.action}: ${status}`, { args: a, authorizationId: id, ...(str(d.detail) && { note: str(d.detail), detail: str(d.detail) }) });
        break;
      }
      case "authorization.consumed": case "authorization.expired": case "authorization.cancelled": {
        const status = e.type.slice("authorization.".length) as AuthorizationStatus;
        const az = patchAuth(str(d.authorizationId) ?? "", () => ({ status, closedAt: e.at }));
        const a = { ...authArgs(d), ...(az && { tool: az.tool, action: az.action, resource: az.resource }) };
        log(e, `authorization_${status}` as LogType, `Authorization for ${a.tool} · ${a.action} ${status}`, { args: a, ...(str(d.authorizationId) && { authorizationId: str(d.authorizationId) }), ...(az?.detail && { note: az.detail, detail: az.detail }) });
        break;
      }
      case "review.decided": {
        const status = d.status as Exclude<ReviewStatus, "pending" | "withdrawn">;
        // A decision on an authorization request belongs to the authorization, not to a check-in or review request.
        const az = (status === "approved" || status === "rejected") && patchAuth(str(d.reviewId) ?? "", () => ({
          status, decidedAt: e.at, ...(Number(d.expiresAt) ? { expiresAt: Number(d.expiresAt) } : {}), ...(str(d.note) && { note: str(d.note) }),
        }));
        if (az) {
          log(e, `authorization_${status}`, `${status === "approved" ? "Approved" : "Rejected"} ${name(e.agentId)}’s request to run ${az.tool} · ${az.action}`,
            { args: { tool: az.tool, action: az.action, resource: az.resource }, authorizationId: az.id, ...(str(d.note) && { note: str(d.note) }), ...(az.detail && { detail: az.detail }) });
          break;
        }
        const hit = findReview(str(d.reviewId) ?? "");
        const target = hit?.list[hit.i];
        if (hit && target) hit.list[hit.i] = { ...target, review: { status, decidedAt: e.at, ...(str(d.note) && { note: str(d.note) }) } } as CheckIn & ReviewRequest;
        const verb = { approved: "Approved", rejected: "Rejected", acknowledged: "Reviewed" }[status];
        const adj = target && "adjustment" in target ? target.adjustment : undefined;
        const what = adj && status !== "acknowledged" ? `${name(e.agentId)}’s adjustment: ${adj.title}` : `${name(e.agentId)}’s ${target && "reason" in target ? "request" : "check-in"}`;
        const args = { target: target && "reason" in target ? ("request" as const) : ("checkIn" as const), ...(adj && status !== "acknowledged" && { adj: adj.title }) };
        log(e, `review_${status}`, `${verb} ${what}`, { args, checkInId: target && "responses" in target ? target.id : undefined, ...(str(d.note) && { note: str(d.note) }) });
        break;
      }
      case "review.withdrawn": {
        // The authorization's own expired or cancelled event says this, once.
        if (patchAuth(str(d.reviewId) ?? "", () => ({}))) break;
        const hit = findReview(str(d.reviewId) ?? "");
        if (hit) hit.list[hit.i] = { ...hit.list[hit.i], review: { status: "withdrawn", decidedAt: e.at } } as CheckIn & ReviewRequest;
        log(e, "review_withdrawn", `${name(e.agentId)} stopped waiting for approval${str(d.reason) ? ` (${str(d.reason)})` : ""}`, str(d.reason) ? { note: str(d.reason) } : undefined);
        break;
      }
      case "permission.granted": {
        const a = agents[agentAt(e.agentId)];
        const perm = str(d.permission) ?? "";
        if (a && !a.permissions.includes(perm)) patchAgent(e.agentId, { permissions: [...a.permissions, perm] });
        if (Number(d.version)) patchAgent(e.agentId, { configVersion: Number(d.version) });
        log(e, "permission_granted", `Granted ${perm} to ${name(e.agentId)}`, { args: { perm } });
        break;
      }
      case "policy.updated": case "policy.central_updated": case "policy.central_assigned": case "policy.central_unassigned":
        // Only the version: what the rules are is not for the page's data, and visitors get no more than this.
        if (Number(d.version)) patchAgent(e.agentId, { configVersion: Number(d.version) });
        break;
      case "agent.paused": case "agent.resumed": case "integration.disabled": case "integration.enabled": {
        const v = Number(d.version) ? { configVersion: Number(d.version) } : {};
        if (e.type === "agent.paused") { patchAgent(e.agentId, { status: "paused", ...v }); delete tasks[e.agentId]; }
        if (e.type === "agent.resumed") patchAgent(e.agentId, { status: "active", ...v });
        if (e.type === "integration.disabled") { patchAgent(e.agentId, { integrationEnabled: false, ...v }); delete tasks[e.agentId]; }
        if (e.type === "integration.enabled") patchAgent(e.agentId, { integrationEnabled: true, ...v });
        const label = { "agent.paused": ["agent_paused", "Paused"], "agent.resumed": ["agent_resumed", "Resumed"], "integration.disabled": ["integration_disabled", "Disabled the integration of"], "integration.enabled": ["integration_enabled", "Enabled the integration of"] }[e.type] as [LogType, string];
        log(e, label[0], `${label[1]} ${name(e.agentId)}`, str(d.note) ? { note: str(d.note) } : undefined);
        break;
      }
      case "checkin.requested":
        asks[e.agentId] = { id: str(d.askId) ?? e.id, at: e.at, delivered: false };
        log(e, "checkin_requested", `Requested a check-in from ${name(e.agentId)}`);
        break;
      case "checkin.request.delivered":
        if (asks[e.agentId]) asks[e.agentId] = { ...asks[e.agentId], delivered: true };
        log(e, "checkin_delivered", `Check-in request delivered to ${name(e.agentId)}`);
        break;
      case "config.acknowledged":
        patchAgent(e.agentId, { ackedVersion: Number(d.version) || 0 });
        log(e, "config_acknowledged", `${name(e.agentId)} applied configuration v${Number(d.version) || 0}`, { args: { version: Number(d.version) || 0 } });
        break;
      case "agent.disconnected":
        patchAgent(e.agentId, { disconnectedAt: e.at });
        delete tasks[e.agentId];
        log(e, "agent_disconnected", `${name(e.agentId)} disconnected`, str(d.reason) ? { note: str(d.reason) } : undefined);
        break;
      case "agent.registered": {
        const profile = d.agent as Agent | undefined;
        if (profile && agentAt(profile.id) < 0) agents.push(profile);
        log(e, "agent_registered", `Registered ${name(e.agentId)} as a connected agent`);
        break;
      }
      case "key.rotated":
        log(e, "key_rotated", `Rotated ${name(e.agentId)}’s API key`);
        break;
      case "key.revoked":
        log(e, "key_revoked", `Revoked ${name(e.agentId)}’s API key`);
        break;
      case "tool.called": {
        const tool = str(d.tool) ?? "", action = str(d.action) ?? "", outcome = d.outcome as ToolOutcome, policy = str(d.policy);
        const detail = str(d.detail);
        freshTasks.push({
          id: e.id, seq: e.seq, agentId: e.agentId, at: e.at, type: e.type, source: source(e.actor), tool, action, outcome,
          // Technical identifiers, shown as written (not translated).
          title: [tool, action, str(d.resource)].filter(Boolean).join(" · "),
          summary: [outcome, policy, str(d.via) && `via ${str(d.via)}`, str(d.approvalId) && `approval ${str(d.approvalId)}`].filter(Boolean).join(" · "),
          ...(str(d.taskId) && { taskId: str(d.taskId) }), ...(str(d.resource) && { resource: str(d.resource) }), ...(policy && { policy }),
          ...(detail && { detail }), ...(str(d.error) && { error: str(d.error) }),
          ...(str(d.authorizationId) && { authorizationId: str(d.authorizationId) }), ...(str(d.via) && { via: str(d.via) }),
        });
        if (outcome === "pending_approval")
          freshRequests.push({ id: e.id, agentId: e.agentId, createdAt: e.at, source: source(e.actor), approval: true, reason: `Approval required: ${tool} · ${action}${detail ? ` — ${detail}` : ""}`, review: { status: "pending" } });
        break;
      }
      case "alert.raised": {
        const kind = d.kind as "policy_violation" | "repeated_failures" | "unapproved_execution" | "authorization_replay" | "authorization_mismatch" | "unauthorized_execution";
        const eventId = str(d.eventId);
        // Authorization alerts raised at consume time were refused; those raised on an execution report ran anyway.
        const authAlert = kind === "authorization_replay" || kind === "authorization_mismatch";
        const tool = str(d.tool), action = str(d.action), policy = str(d.policy), count = Number(d.count) || undefined, blocked = authAlert ? !eventId : d.blocked === true;
        if (authAlert) patchAuth(str(d.authorizationId) ?? "", (a) => ({ alerts: a.alerts + 1, ...(d.revoked === true && { status: "cancelled" as const, reason: "revoked", closedAt: e.at }) }));
        const summary = {
          policy_violation: `${blocked ? "Blocked" : "Unblocked"} policy violation by ${name(e.agentId)}: ${tool} · ${action} (${policy})`,
          repeated_failures: `${name(e.agentId)}: ${tool} failed ${count} times in ${Number(d.windowMinutes) || 5} minutes`,
          unapproved_execution: `${name(e.agentId)} ran ${tool} · ${action} without a valid approval (${str(d.reason)})`,
          authorization_replay: `${name(e.agentId)} reused an authorization for ${tool} · ${action} (${str(d.reason)})`,
          authorization_mismatch: `${name(e.agentId)} used an authorization for something else: ${tool} · ${action} (${str(d.reason)})`,
          unauthorized_execution: `${name(e.agentId)} ran ${tool} · ${action} without a Tend authorization`,
        }[kind];
        // What was affected, from the alert or (for older alerts) from the call it points to.
        const call = eventId ? [...freshTasks, ...p.taskEvents].find((x) => x.id === eventId) : undefined;
        const resource = str(d.resource) ?? call?.resource, outcome = str(d.outcome) ?? call?.outcome;
        const what = kind === "repeated_failures" ? `${count} failures` : kind === "policy_violation" ? outcome : str(d.reason);
        const note = [resource, what].filter(Boolean).join(" · ");
        if (summary) log(e, kind, summary, { args: { tool, action, policy, count, blocked, ...(str(d.reason) && { reason: str(d.reason) }) }, ...(note && { note }), ...(eventId && { eventId }) });
        break;
      }
      case "task.started": case "task.completed": case "task.failed": case "agent.idle": {
        const t: TaskEvent = {
          id: e.id, seq: e.seq, agentId: e.agentId, at: e.at, type: e.type, source: source(e.actor),
          ...(str(d.taskId) && { taskId: str(d.taskId) }), ...(str(d.title) && { title: str(d.title) }),
          ...(str(d.detail) && { detail: str(d.detail) }), ...(str(d.summary) && { summary: str(d.summary) }), ...(str(d.error) && { error: str(d.error) }),
        };
        if (e.type === "task.started") {
          tasks[e.agentId] = { taskId: t.taskId ?? e.id, title: t.title ?? "", ...(t.detail && { detail: t.detail }), startedAt: e.at };
        } else if (e.type === "agent.idle" || tasks[e.agentId]?.taskId === t.taskId) {
          delete tasks[e.agentId];
        }
        // Give completion events the title of the task they finish.
        const startOf = (x: TaskEvent) => x.taskId === t.taskId && x.type === "task.started";
        if (!t.title && t.taskId) t.title = [...freshTasks].reverse().find(startOf)?.title ?? p.taskEvents.find(startOf)?.title;
        freshTasks.push(t);
        break;
      }
    }
  }

  const newest = <T,>(fresh: T[], old: T[], n: number) => (fresh.length ? [...fresh.reverse(), ...old].slice(0, n) : old);
  return {
    agents,
    tasks,
    asks,
    checkIns: newest(freshCheckIns, oldCheckIns, LIMIT.checkIns),
    requests: newest(freshRequests, oldRequests, LIMIT.requests),
    authorizations: newest(freshAuths, oldAuths, LIMIT.authorizations),
    log: newest(freshLog, p.log, LIMIT.log),
    taskEvents: newest(freshTasks, p.taskEvents, LIMIT.taskEvents),
  };
}

/** Connected agents count as offline two minutes after they were last heard from. */
export const PRESENCE_TTL = 120_000;

export function isOnline(a: Agent, now: number) {
  if (a.origin === "demo") return true;
  if (!a.lastSeenAt) return false;
  if (a.disconnectedAt && a.disconnectedAt >= a.lastSeenAt) return false;
  return now - a.lastSeenAt < PRESENCE_TTL;
}
