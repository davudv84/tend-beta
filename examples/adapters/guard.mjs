// The one shared adapter: wrap a tool function so it runs only on TEND's yes. Every framework adapter in this folder (and the MCP proxy)
// asks TEND the same way: tool name, action "call", a hash of all arguments as the resource, the readable arguments as the detail.
//
//   const gate = connectTend();                                       // examples/claude-quickstart/tend-client.mjs
//   const readNote = guardTool(gate, "read_note", async (args) => ...); // then hand readNote to your framework as the tool body
//
// The wrapped function returns the tool's own result when TEND allowed it, and otherwise a sentence that starts with "Not done", so the
// model can tell the user the action did not happen. It never throws for a refusal: frameworks differ in what an exception does.
import { toRequest } from "../mcp-proxy/tend-mcp-proxy.mjs";

/** Why it did not happen, in words a developer can act on. The code stays in parentheses for searching logs. */
const HINTS = {
  no_policy: (t) => `no rule for ${t} · call yet: add one in TEND (Policies, "Your agent's own tools")`,
  policy_denied: () => "the policy says never",
  invalid_policy: () => "the saved policy cannot be read, so everything is blocked",
  rejected: () => "a person rejected it",
  expired: () => "nobody decided in time",
  no_decision: () => "nobody decided in time",
  not_permitted: () => "the policy or the agent changed before it ran",
  already_consumed: () => "this exact call was already authorized once, and is not run twice",
  invalid_key: () => "TEND does not accept this agent key (revoked, or from another TEND: check TEND_URL and TEND_AGENT_KEY)",
  agent_paused: () => "the agent is paused in TEND",
};
/** The text a model sees when TEND did not allow a call. */
export const notDone = (out, tool = "this tool") => {
  const hint = HINTS[out.reason]?.(tool) ?? HINTS[out.outcome]?.(tool);
  return `Not done: TEND did not allow this tool call (${out.outcome}${out.reason ? `: ${out.reason}` : ""}${hint ? `; ${hint}` : ""}${out.detail ? `; ${out.detail}` : ""}).`;
};
/**
 * Wraps a tool function. The function receives a private copy of the arguments, taken when TEND was asked, so what runs is exactly what was
 * authorized even if the caller changes its own object afterwards. Pass the framework's tool-call id as the second argument when it has one:
 * the same call delivered twice then runs once.
 */
export function guardTool(gate, name, fn) {
  return async (args = {}, callId) => {
    let snapshot;
    try {
      snapshot = structuredClone(args);
    } catch {
      return notDone({ outcome: "refused", reason: "arguments that cannot be copied" }, name);
    }
    const request = toRequest({ name, arguments: snapshot });
    if (!request) return notDone({ outcome: "refused", reason: "tool name TEND cannot accept" }, name);
    const key = typeof callId === "string" && callId ? `call-${callId}`.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 64) : undefined;
    const out = await gate.run({ ...request, ...(key && { idempotencyKey: key }) }, () => fn(snapshot));
    if (!out.executed) return notDone(out, name);
    return out.outcome === "success" ? out.result : "TEND allowed this call, but the tool itself failed.";
  };
}
