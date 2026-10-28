// What the permissions screen shows: every gateway tool with the decision the server would actually make for it, computed
// by the real evaluator from the saved policy. The screen shows this, never its own idea of what it saved.
import type { Q } from "./db.ts";
import { toolCatalog } from "./gateway.ts";
import { evaluate, parsePolicy } from "./policy.ts";
import { agentRow, toAgent } from "./repo.ts";
import { HttpError } from "./http.ts";

export async function policyView(q: Q, agentId: string) {
  const row = await agentRow(q, agentId);
  if (!row) throw new HttpError(404, "agent_not_found", `No agent with id “${agentId}”.`);
  const parsed = parsePolicy(row.policy);
  const rules = parsed.ok ? parsed.rules : [];
  // Judge the rules, not the agent's current state: a paused agent still has the policy it has.
  const probe = { status: "active" as const, integrationEnabled: true, permissions: toAgent(row).permissions };
  const tools = toolCatalog().map((t) => ({
    ...t,
    // An unreadable policy denies everything, as at run time.
    effect: parsed.ok ? evaluate(probe, rules, { tool: t.tool, action: t.action, resource: null, detail: null }).effect : ("deny" as const),
    // Rules that the three-way choice cannot express (a resource prefix, a permission, a wildcard, another action).
    custom: rules.some((r) => r.tool === t.tool && !(r.action === t.action && r.resourcePrefix === undefined && r.permission === undefined)),
  }));
  return { agentId, version: row.config_version, enforcement: row.enforcement, valid: parsed.ok, rules, tools };
}
