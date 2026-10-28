#!/usr/bin/env node
// A real OpenAI agent (official OpenAI Agents SDK, @openai/agents) whose only tools are TEND gateway tools.
//
//   npm run agents:openai                       default task: read, write, then try to delete
//   npm run agents:openai -- --task write       one of: all | read | write | delete
//   npm run agents:openai -- "your own prompt"
//
// Needs OPENAI_API_KEY and TEND_OPENAI_AGENT_KEY (or TEND_AGENT_KEY); see docs/manual-testing.md.
// TEND, not this SDK, decides what runs: the SDK's own `needsApproval` is deliberately unused, because an approval that lives
// inside the agent process is one the agent could skip. Each tool's `execute` only forwards to TEND (toolbox.mjs).
import { Agent, OpenAIProvider, Runner, run, setTracingDisabled, tool } from "@openai/agents";
import { z } from "zod";
import { keyPrefix, loadAgentEnvDetailed, need, resolveAgent } from "./env.mjs";
import { MAX_TURNS, PROMPTS, SYSTEM, TOOL_DEFS, printPending, startSession, summarize, tendHttp } from "./toolbox.mjs";

export const MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

/** zod for the same parameters toolbox.mjs describes in JSON Schema. Strict: exactly these string fields. */
const shape = (def) => z.object(Object.fromEntries(Object.keys(def.params).map((k) => [k, z.string()])));

/**
 * @param session  from startSession(); every tool call goes through session.callTool
 * @param opts.model  OpenAI model name
 */
export function buildOpenAIAgent(session, { model = MODEL } = {}) {
  const tools = TOOL_DEFS.map((def) =>
    tool({
      name: def.name,
      description: def.description,
      parameters: shape(def),
      // `details.toolCall.callId` is the provider's id for this call: a repeated id gets the first answer, not a second request.
      execute: async (input, _ctx, details) => (await session.callTool(def.name, input, details?.toolCall?.callId)).content,
      // Whatever goes wrong inside the SDK is reported to the model as text; nothing here can reach the sandbox.
      errorFunction: () => JSON.stringify({ error: "Not executed (tool_error)." }),
    }),
  );
  return new Agent({ name: "TEND test agent", instructions: SYSTEM, model, tools });
}

/** @param openaiClient  optional OpenAI SDK client (tests point `baseURL` at a local fake); by default the SDK uses OPENAI_API_KEY */
export async function runOpenAIAgent({ tend, env, openaiClient, prompt = PROMPTS.all, model = MODEL, keyInfo = undefined, approvalTimeoutMs, pollMs, onPending = printPending, log = () => {}, maxTurns = MAX_TURNS }) {
  // Run data (prompts, tool inputs, file text) would be uploaded to OpenAI's tracing service by default. Off unless asked for.
  setTracingDisabled(!(env ?? process.env).OPENAI_AGENTS_TRACING);
  const session = await startSession({ provider: "OpenAI", model, tend, env, keyInfo, prompt, approvalTimeoutMs, pollMs, onPending, log });
  let result, failure;
  try {
    const agent = buildOpenAIAgent(session, { model });
    result = openaiClient
      ? await new Runner({ modelProvider: new OpenAIProvider({ openAIClient: openaiClient }) }).run(agent, prompt, { maxTurns })
      : await run(agent, prompt, { maxTurns });
  } catch (e) {
    failure = e;
  }
  await session.finish(failure);
  if (failure) throw failure;
  return { provider: "OpenAI", model, calls: session.calls, finalAnswer: String(result.finalOutput ?? ""), usage: result.state?.usage ?? null };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const detail = loadAgentEnvDetailed();
  const { env } = detail;
  need(env, ["OPENAI_API_KEY"], "Put it in .env.agent (OPENAI_API_KEY=...) or export it. It stays in this process; TEND never sees it.");
  const agent = resolveAgent(detail, "openai");
  if (!agent.key) need(env, ["TEND_OPENAI_AGENT_KEY"], "Run `npm run agents:setup` to register the agent with TEND and create the key.");
  for (const w of agent.warnings) console.error(`Warning: ${w}`);
  console.log(`Using TEND at ${agent.url} with key ${keyPrefix(agent.key)} (from ${agent.source})`);
  if (env.OPENAI_BASE_URL) console.log(`OpenAI SDK requests go to ${new URL(env.OPENAI_BASE_URL).host} (OPENAI_BASE_URL is set in your environment), not the OpenAI default.`);
  const args = process.argv.slice(2);
  const i = args.indexOf("--task");
  const prompt = i >= 0 ? PROMPTS[args[i + 1]] : args.find((a) => !a.startsWith("--")) ?? PROMPTS.all;
  if (!prompt) {
    console.error(`Unknown task. Use one of: ${Object.keys(PROMPTS).join(", ")}.`);
    process.exit(2);
  }
  process.env.OPENAI_API_KEY = env.OPENAI_API_KEY; // the SDK reads it from the process environment
  const tend = tendHttp(agent.url, agent.key);
  try {
    const out = await runOpenAIAgent({ tend, env, keyInfo: agent, prompt, log: console.log });
    console.log("\nTool calls:\n  " + (summarize(out.calls).join("\n  ") || "(none)"));
    console.log(`\nAgent says: ${out.finalAnswer}`);
  } catch (e) {
    console.error(`\nFailed: ${String(e?.message ?? e).split("\n")[0]}`);
    process.exit(1);
  }
}
