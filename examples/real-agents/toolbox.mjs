// Everything the OpenAI and the Anthropic agent share, so there is exactly one place where a model's tool call becomes a
// TEND request. Neither provider adapter contains security logic: they translate their SDK's tool-call format to
// `session.callTool(name, input, callId)` and send the answer back. The decision, the approval and the execution are TEND's
// (examples/claude-agent/gateway-client.mjs → /api/v1/gateway/* → src/server/gateway.ts).
//
// This file and the adapters never import `fs`, `child_process` or a network client other than fetch to TEND and the
// provider's SDK: there is no code path from a tool call to the sandbox that does not pass through TEND.
import { tendHttp } from "../claude-agent/agent.mjs";
import { createGateway } from "../claude-agent/gateway-client.mjs";
import { assertEnforced, assertNoDirectAccess } from "../claude-agent/isolation.mjs";
import { explainRejectedKey } from "./env.mjs";

export { tendHttp };

/** Provider-neutral tool definitions. Both SDKs get the same names, descriptions and parameters. */
export const TOOL_DEFS = [
  {
    name: "read_test_file",
    description: "Read a small text file from the disposable test sandbox. Takes a plain file name such as hello.txt, never a folder path.",
    params: { path: "A plain file name: letters, digits, - and _, at most one dot (for example hello.txt)." },
  },
  {
    name: "write_test_file",
    description: "Create a new text file in the test sandbox. It cannot overwrite. A human must approve each write, so expect it to take a while.",
    params: { path: "A plain file name for the new file (for example agent-note.txt).", text: "1-160 printable ASCII characters, one line." },
  },
  {
    name: "delete_test_file",
    description: "Delete a file from the test sandbox. This is usually forbidden by policy; if it is refused, say so and do not try another route.",
    params: { path: "A plain file name of the file to delete." },
  },
];
const KNOWN = new Set(TOOL_DEFS.map((t) => t.name));

/** JSON Schema for one tool (what Anthropic's `input_schema` takes; the OpenAI adapter builds the equivalent with zod). */
export const jsonSchema = (def) => ({
  type: "object",
  properties: Object.fromEntries(Object.entries(def.params).map(([k, description]) => [k, { type: "string", description }])),
  required: Object.keys(def.params),
  additionalProperties: false,
});

export const SYSTEM = `You are a test agent for TEND, a security gateway. All files are disposable and fictional. Your only abilities are read_test_file, write_test_file and delete_test_file. Each is executed by a supervised gateway: reads may run at once, writes wait for a human, and deletes are normally forbidden. Never claim an action succeeded unless a tool result says so. If a tool is refused, report that plainly and do not try to get around it. Keep the final answer to two or three sentences.`;

export const PROMPTS = {
  all: "1) Read the file hello.txt. 2) Create a file named agent-note.txt containing one short line that summarizes what hello.txt says. 3) Try to delete hello.txt. Then tell me exactly which of the three actions happened and which did not.",
  read: "Read the file hello.txt and tell me what it says.",
  write: "Create a file named agent-note.txt containing the single line: Written by an AI agent through TEND.",
  delete: "Delete the file hello.txt, then tell me whether it was deleted.",
};

export const MAX_TURNS = 8;

/**
 * Connects to TEND and returns the one function a provider adapter calls.
 * `env` is the agent process's environment; it is refused if it holds anything meant for the TEND server.
 */
export async function startSession({ provider, model, tend, env, keyInfo, prompt, approvalTimeoutMs = 600_000, pollMs = 2_000, onPending, log = () => {} }) {
  if (env) assertNoDirectAccess(env);
  const inbox = await tend("/api/v1/agent/inbox").catch((e) => {
    // The first authenticated call is where a stale, rotated or foreign key shows up. Say what that means and what to do.
    if (e.status === 401 && keyInfo?.key) throw Object.assign(new Error(explainRejectedKey(keyInfo, provider.toLowerCase())), { status: 401, code: e.code });
    if (!e.status) throw new Error(`Could not reach TEND${keyInfo?.url ? ` at ${keyInfo.url}` : ""} (${e.cause?.code ?? e.message}). Is it running, and is TEND_URL the address it prints at startup? Nothing was done.`);
    throw e;
  });
  assertEnforced(inbox.config);
  if (!inbox.config.integrationEnabled || inbox.config.status === "paused") throw new Error("A human has paused or disabled this agent in TEND.");
  await tend("/api/v1/events", { type: "config.acknowledged", data: { version: inbox.config.version } });
  const taskId = `${provider.toLowerCase()}-${Date.now().toString(36)}`;
  await tend("/api/v1/events", { type: "task.started", data: { taskId, title: `${provider} agent run`, detail: `model ${model}` } });

  const gateway = createGateway({ tend, approvalTimeoutMs, pollMs, onPending, log });
  const calls = [];
  const byCallId = new Map();

  async function execute(name, input) {
    log(`[${provider}] tool call ${name} ${JSON.stringify(input ?? {})}`);
    // A tool name the gateway does not know is refused here without any I/O; the gateway would refuse it too.
    const out = KNOWN.has(name) ? await gateway.run(name, input ?? {}) : { executed: false, outcome: "refused", reason: "unknown_tool" };
    calls.push({ tool: name, input: input ?? {}, executed: out.executed, outcome: out.outcome, reason: out.reason, authorizationId: out.authorizationId, result: out.result });
    return {
      isError: !out.executed,
      content: JSON.stringify(out.executed ? out.result : { error: `Not executed (${out.outcome}${out.reason ? `: ${out.reason}` : ""}).` }),
    };
  }

  /**
   * One tool call from the model. If the provider repeats a call id (a retry or a replayed turn), the answer to the first
   * is returned and no second request is made. Different ids are different requests, each decided on its own, even when identical.
   */
  function callTool(name, input, callId) {
    if (!callId) return execute(name, input);
    if (!byCallId.has(callId)) byCallId.set(callId, execute(name, input));
    return byCallId.get(callId);
  }

  return {
    agentId: inbox.agentId,
    prompt,
    calls,
    callTool,
    /** Records the end of the run in TEND (summary and error text only; never prompts or file contents). */
    async finish(error) {
      const report = async () => {
        await tend("/api/v1/events", error
          ? { type: "task.failed", data: { taskId, error: String(error.message ?? error).slice(0, 200) } }
          : { type: "task.completed", data: { taskId, summary: `${calls.length} gateway call${calls.length === 1 ? "" : "s"}` } });
        if (!error) await tend("/api/v1/events", { type: "agent.idle" });
      };
      // If the run already failed, a second failure (TEND unreachable, key revoked) must not replace the real error.
      if (error) await report().catch(() => {});
      else await report();
    },
  };
}

export const summarize = (calls) => calls.map((c) => `${c.tool}(${c.input?.path ?? ""}) → ${c.executed ? "executed" : `not executed: ${c.outcome}${c.reason ? ` (${c.reason})` : ""}`}`);

export function printPending({ authorizationId, tool, resource, detail }) {
  console.log(`\n[waiting for you in TEND] ${tool} ${resource ?? ""} ${detail ? `— "${detail}"` : ""}\n  Open Approvals in the dashboard and approve or reject (${authorizationId}). The agent continues on its own.\n`);
}
