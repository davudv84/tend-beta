// The one shared adapter: wrap a tool function so it runs only on TEND's yes. Every framework adapter in this folder (and the MCP proxy)
// asks TEND the same way: tool name, action "call", a hash of all arguments as the resource, the readable arguments as the detail.
//
//   const gate = connectTend();                                       // examples/claude-quickstart/tend-client.mjs
//   const readNote = guardTool(gate, "read_note", async (args) => ...); // then hand readNote to your framework as the tool body
//
// The wrapped function returns the tool's own result when TEND allowed it, and otherwise a sentence that starts with "Not done", so the
// model can tell the user the action did not happen. It never throws for a refusal: frameworks differ in what an exception does.
import { toRequest } from "../mcp-proxy/tend-mcp-proxy.mjs";

/** The text a model sees when TEND did not allow a call. */
export const notDone = (out) => `Not done: TEND did not allow this tool call (${out.outcome}${out.reason ? `: ${out.reason}` : ""}${out.detail ? `; ${out.detail}` : ""}).`;

export function guardTool(gate, name, fn) {
  return async (args = {}) => {
    const request = toRequest({ name, arguments: args });
    if (!request) return notDone({ outcome: "refused", reason: "tool name TEND cannot accept" });
    const out = await gate.run(request, () => fn(args));
    if (!out.executed) return notDone(out);
    return out.outcome === "success" ? out.result : "TEND allowed this call, but the tool itself failed.";
  };
}
