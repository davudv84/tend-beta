// Shared by the operator command line (tend-cli.mjs) and the cross-provider demo: one way to read a rule from the command line and one way
// to put an audit event into a sentence.

/** "tool:action:effect[:resourcePrefix]" -> a policy rule. Throws a sentence on anything else. */
export function parseRule(text) {
  const [tool, action, effect, resourcePrefix] = String(text).split(":");
  if (!tool || !action || !["allow", "approve", "deny"].includes(effect)) throw new Error(`Bad rule "${text}". Use tool:action:effect, where effect is allow, approve or deny.`);
  return { tool, action, effect, ...(resourcePrefix && { resourcePrefix }) };
}

const brief = (rules) => (Array.isArray(rules) ? rules.map((r) => `${r.tool.replace("_test_file", "")}=${r.effect}`).join(" ") : "");

/** One audit event as a line a person can read, or "" for events that are not about permissions and actions. */
export function describeEvent(e, names = {}) {
  const d = e.data ?? {}, who = names[e.agentId] ?? e.agentId, what = `${d.tool}.${d.action}${d.resource ? ` ${d.resource}` : ""}`;
  if (e.type === "policy.updated") return `${who}: own rules set [${brief(d.policy) || "none"}]`;
  if (e.type === "policy.central_assigned") return `${who}: assigned central policy "${d.name}" v${d.policyVersion} [${brief(d.policy)}]`;
  if (e.type === "policy.central_updated") return `${who}: central policy "${d.name}" changed to v${d.policyVersion} [${brief(d.policy)}]`;
  if (e.type === "policy.central_unassigned") return `${who}: central policy "${d.name}" removed`;
  if (e.type === "review.decided") return `${who}: a person ${d.status} a held request`;
  if (e.type === "key.revoked") return `${who}: key revoked`;
  if (e.type === "key.rotated") return `${who}: key replaced`;
  if (e.type === "agent.registered") return `${who}: registered`;
  const by = d.policySource === "central" ? `, by central policy v${d.centralVersion}` : "";
  if (/^authorization\./.test(e.type)) return `${who}: ${e.type.slice(14)} ${what}${d.reason ? ` (${d.reason}${by})` : ""}`;
  return "";
}
