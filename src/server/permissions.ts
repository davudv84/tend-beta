// What the permissions screen shows: every gateway tool with the decision the server would actually make for it, computed
// by the real evaluator from the saved policy. The screen shows this, never its own idea of what it saved.
import type { Q } from "./db.ts";
import { toolCatalog } from "./gateway.ts";
import { evaluateEffective, parsePolicy } from "./policy.ts";
import { agentRow, centralOf, toAgent } from "./repo.ts";
import { HttpError } from "./http.ts";

export async function policyView(q: Q, agentId: string) {
  const row = await agentRow(q, agentId);
  if (!row) throw new HttpError(404, "agent_not_found", `No agent with id “${agentId}”.`);
  const parsed = parsePolicy(row.policy);
  const rules = parsed.ok ? parsed.rules : [];
  const central = await centralOf(q, row);
  const centralRules = central ? parsePolicy(central.policy) : undefined;
  // Judge the rules, not the agent's current state: a paused agent still has the policy it has.
  const probe = { status: "active" as const, integrationEnabled: true, permissions: toAgent(row).permissions };
  // The agent's own tools (and the central policy's): every tool a rule names that is not one of TEND's gateway tools, decided the same way.
  const catalog = toolCatalog();
  const own = [...rules, ...(centralRules?.ok ? centralRules.rules : [])]
    .filter((r, i, all) => r.action !== "*" && !catalog.some((t) => t.tool === r.tool) && all.findIndex((x) => x.tool === r.tool) === i)
    .map((r) => ({ tool: r.tool, action: r.action, risk: "write" as const, available: true, own: true }));
  const tools = [...catalog, ...own].map((t) => ({
    ...t,
    // An unreadable policy denies everything, as at run time.
    effect: evaluateEffective(probe, parsed.ok ? rules : row.policy, central?.policy, { tool: t.tool, action: t.action, resource: null, detail: null }).effect,
    source: evaluateEffective(probe, parsed.ok ? rules : row.policy, central?.policy, { tool: t.tool, action: t.action, resource: null, detail: null }).source,
    // Rules that the three-way choice cannot express (a resource prefix, a permission, a wildcard, another action).
    custom: rules.some((r) => r.tool === t.tool && !(r.action === t.action && r.resourcePrefix === undefined && r.permission === undefined)),
  }));
  return { agentId, version: row.config_version, enforcement: row.enforcement, valid: parsed.ok, rules, tools,
    central: central ? { id: central.id, version: central.version, valid: !!centralRules?.ok, rules: centralRules?.ok ? centralRules.rules : [] } : null };
}
