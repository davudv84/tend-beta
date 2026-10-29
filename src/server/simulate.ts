// Policy simulation: what a proposed policy would have decided for the actions agents actually asked for. It replays recorded authorization
// requests through the same decision function TEND enforces with (policy.ts evaluateEffective) and compares with what was decided then.
//
// It never runs a tool and never changes anything: it reads through readOnly() (verification.ts), which refuses every statement that is not a
// plain read, and it imports no tool code. A proposed policy is checked like a saved one; an invalid one is refused, not simulated.
//
// Targets:  { agentId, rules }              the agent's own rules replaced; its central policy, if any, still applies (as it would)
//           { centralPolicyId, rules }      that central policy's rules replaced, for every agent assigned to it
//           { centralPolicyId?, agentIds, rules }  as a central policy for these agents (what assigning it would do)
// What is decided is the policy's effect alone: a paused or disabled agent is simulated as active, so the answer is about the rules.
import type { Q } from "./db.ts";
import { HttpError } from "./http.ts";
import { evaluateEffective, parsePolicy, policyProblem, type Effect } from "./policy.ts";
import { DEFAULT_WORKSPACE } from "./session.ts";
import { readOnly } from "./verification.ts";

export const SIMULATION = { maxActions: 5_000, defaultDays: 30, maxDays: 90, examples: 50 };
interface Row { id: string; agent_id: string; tool: string; action: string; resource: string | null; detail: string | null; status: string; reason: string | null; created_at: number }
interface AgentRow { id: string; profile: string; permissions: string; policy: string; central_policy_id: string | null; workspace_id: string }

/** What was decided when the agent asked: allowed by policy, held for a person, or denied (for whatever reason). */
const recorded = (r: Row): Effect => (r.reason === "policy_allowed" ? "allow" : r.reason === "approval_required" ? "approve" : "deny");

export async function simulatePolicy(db: Q, input: unknown, workspace = DEFAULT_WORKSPACE, now = Date.now()) {
  const o = (input ?? {}) as { rules?: unknown; agentId?: unknown; agentIds?: unknown; centralPolicyId?: unknown; days?: unknown };
  const parsed = parsePolicy(o.rules);
  if (!parsed.ok) throw new HttpError(422, "invalid_policy", parsed.error);
  const problem = policyProblem(parsed.rules);
  if (problem) throw new HttpError(422, "invalid_policy", problem);
  const days = o.days === undefined ? SIMULATION.defaultDays : Number(o.days);
  if (!Number.isInteger(days) || days < 1 || days > SIMULATION.maxDays) throw new HttpError(422, "invalid_days", `days must be 1–${SIMULATION.maxDays}.`);
  const q = readOnly(db);
  const ws = async (sql: string, ...p: unknown[]) => (await q.all<AgentRow>(`SELECT id, profile, permissions, policy, central_policy_id, workspace_id FROM agents WHERE workspace_id = ? AND origin = 'connected' AND ${sql}`, workspace, ...p));

  // Which agents, and how each one's two policies would look.
  let mode: "agent" | "central" | "assign";
  let agents: AgentRow[];
  if (typeof o.agentId === "string") {
    mode = "agent";
    agents = await ws("id = ?", o.agentId);
    if (!agents.length) throw new HttpError(404, "agent_not_found", `No agent with id “${o.agentId}”.`);
  } else if (Array.isArray(o.agentIds)) {
    if (!o.agentIds.length || o.agentIds.length > 50 || o.agentIds.some((x) => typeof x !== "string")) throw new HttpError(422, "invalid_agents", "agentIds must be a list of up to 50 agent ids.");
    mode = "assign";
    agents = (await ws("TRUE")).filter((a) => (o.agentIds as string[]).includes(a.id));
    if (agents.length !== new Set(o.agentIds).size) throw new HttpError(404, "agent_not_found", "One of the agents does not exist.");
  } else if (typeof o.centralPolicyId === "string") {
    mode = "central";
    const c = await q.get<{ id: string }>("SELECT id FROM central_policies WHERE id = ? AND workspace_id = ?", o.centralPolicyId, workspace);
    if (!c) throw new HttpError(404, "central_policy_not_found", `No central policy with id “${o.centralPolicyId}”.`);
    agents = await ws("central_policy_id = ?", o.centralPolicyId);
  } else throw new HttpError(422, "invalid_target", "Give agentId, agentIds or centralPolicyId.");

  const centrals = new Map((await q.all<{ id: string; policy: string }>("SELECT id, policy FROM central_policies WHERE workspace_id = ?", workspace)).map((c) => [c.id, c.policy]));
  const proposed = JSON.stringify(parsed.rules);
  const policiesOf = (a: AgentRow) => {
    const current = a.central_policy_id ? centrals.get(a.central_policy_id) ?? null : undefined; // null: a dangling id, which denies (evaluateEffective)
    if (mode === "agent") return { own: proposed, central: current };
    return { own: a.policy, central: proposed };
  };

  const ids = agents.map((a) => a.id);
  const rows = ids.length
    ? await q.all<Row>(`SELECT id, agent_id, tool, action, resource, detail, status, reason, created_at FROM authorizations WHERE agent_id IN (${ids.map(() => "?").join(", ")}) AND created_at >= ? ORDER BY created_at DESC LIMIT ?`,
      ...ids, now - days * 86_400_000, SIMULATION.maxActions + 1)
    : [];
  const truncated = rows.length > SIMULATION.maxActions;
  const totals = { allow: 0, approve: 0, deny: 0 };
  const before = { allow: 0, approve: 0, deny: 0 };
  const perAgent = new Map<string, { id: string; name: string; actions: number; changed: number; would: Record<Effect, number> }>();
  const changes: Record<string, number> = {};
  const examples: { id: string; agentId: string; tool: string; action: string; resource: string | null; at: number; was: Effect; would: Effect; reason: string }[] = [];
  for (const a of agents) perAgent.set(a.id, { id: a.id, name: (JSON.parse(a.profile) as { name: string }).name, actions: 0, changed: 0, would: { allow: 0, approve: 0, deny: 0 } });
  for (const r of rows.slice(0, SIMULATION.maxActions)) {
    const a = agents.find((x) => x.id === r.agent_id)!;
    const { own, central } = policiesOf(a);
    const d = evaluateEffective({ status: "active", integrationEnabled: true, permissions: JSON.parse(a.permissions) }, JSON.parse(own), central === undefined ? undefined : central === null ? null : JSON.parse(central),
      { tool: r.tool, action: r.action, resource: r.resource, detail: r.detail });
    const was = recorded(r);
    totals[d.effect]++;
    before[was]++;
    const p = perAgent.get(a.id)!;
    p.actions++;
    p.would[d.effect]++;
    if (was !== d.effect) {
      p.changed++;
      changes[`${was}->${d.effect}`] = (changes[`${was}->${d.effect}`] ?? 0) + 1;
      if (examples.length < SIMULATION.examples) examples.push({ id: r.id, agentId: a.id, tool: r.tool, action: r.action, resource: r.resource, at: Number(r.created_at), was, would: d.effect, reason: d.reason });
    }
  }
  return {
    executed: false as const, mode, days, actions: Math.min(rows.length, SIMULATION.maxActions), truncated,
    would: totals, was: before, changes, examples,
    agents: [...perAgent.values()], affected: [...perAgent.values()].filter((p) => p.changed > 0).map((p) => p.id),
  };
}
