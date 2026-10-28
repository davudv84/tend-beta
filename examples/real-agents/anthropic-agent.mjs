#!/usr/bin/env node
// A real Claude agent (official Anthropic SDK, @anthropic-ai/sdk, Messages API tool use) whose only tools are TEND gateway tools.
//
//   npm run agents:anthropic                    default task: read, write, then try to delete
//   npm run agents:anthropic -- --task write    one of: all | read | write | delete
//   npm run agents:anthropic -- "your own prompt"
//
// Needs ANTHROPIC_API_KEY and TEND_ANTHROPIC_AGENT_KEY (or TEND_AGENT_KEY); see docs/manual-testing.md.
// A manual tool-use loop on purpose: the loop is ours so that every tool_use block goes to TEND and nothing runs in-process.
import "../../scripts/node-check.mjs";
import Anthropic from "@anthropic-ai/sdk";
import { keyPrefix, loadAgentEnvDetailed, need, resolveAgent } from "./env.mjs";
import { MAX_TURNS, PROMPTS, SYSTEM, TOOL_DEFS, jsonSchema, printPending, startSession, summarize, tendHttp } from "./toolbox.mjs";

// The project's existing default for Claude test agents (examples/claude-agent): a small model, because these runs are
// repeated security tests. Set CLAUDE_MODEL to use another.
export const MODEL = process.env.CLAUDE_MODEL ?? "claude-haiku-4-5";
const MAX_TOKENS = 1024;

export const ANTHROPIC_TOOLS = TOOL_DEFS.map((def) => ({ name: def.name, description: def.description, input_schema: jsonSchema(def) }));

/** @param client  an Anthropic SDK client (tests point `baseURL` at a local fake; the CLI uses the real API) */
export async function runAnthropicAgent({ client, tend, env, prompt = PROMPTS.all, model = MODEL, keyInfo = undefined, approvalTimeoutMs, pollMs, onPending = printPending, log = () => {}, maxTurns = MAX_TURNS }) {
  const session = await startSession({ provider: "Anthropic", model, tend, env, keyInfo, prompt, approvalTimeoutMs, pollMs, onPending, log });
  const usage = { calls: 0, input_tokens: 0, output_tokens: 0 };
  const messages = [{ role: "user", content: prompt }];
  let finalAnswer = "", failure, stop = null;
  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      const res = await client.messages.create({ model, max_tokens: MAX_TOKENS, system: SYSTEM, tools: ANTHROPIC_TOOLS, messages });
      usage.calls++;
      usage.input_tokens += res.usage?.input_tokens ?? 0;
      usage.output_tokens += res.usage?.output_tokens ?? 0;
      stop = res.stop_reason;
      messages.push({ role: "assistant", content: res.content });
      if (res.stop_reason !== "tool_use") {
        finalAnswer = res.content.filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
        break;
      }
      const results = [];
      for (const block of res.content) {
        if (block.type !== "tool_use") continue;
        const out = await session.callTool(block.name, block.input, block.id);
        results.push({ type: "tool_result", tool_use_id: block.id, content: out.content, ...(out.isError && { is_error: true }) });
      }
      messages.push({ role: "user", content: results });
      if (turn === maxTurns - 1) throw new Error("The agent did not finish within the turn limit.");
    }
  } catch (e) {
    failure = e;
  }
  await session.finish(failure);
  if (failure) throw failure;
  return { provider: "Anthropic", model, calls: session.calls, finalAnswer, stop, usage };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const detail = loadAgentEnvDetailed();
  const { env } = detail;
  need(env, ["ANTHROPIC_API_KEY"], "Put it in .env.agent (ANTHROPIC_API_KEY=...) or export it. Agents do not read .env.local. It stays in this process; TEND never sees it.");
  const agent = resolveAgent(detail, "anthropic");
  if (!agent.key) need(env, ["TEND_ANTHROPIC_AGENT_KEY"], "Run `npm run agents:setup` to register the agent with TEND and create the key.");
  for (const w of agent.warnings) console.error(`Warning: ${w}`);
  console.log(`Using TEND at ${agent.url} with key ${keyPrefix(agent.key)} (from ${agent.source})`);
  if (env.ANTHROPIC_BASE_URL) console.log(`Anthropic SDK requests go to ${new URL(env.ANTHROPIC_BASE_URL).host} (ANTHROPIC_BASE_URL is set in your environment), not the Anthropic default.`);
  const args = process.argv.slice(2);
  const i = args.indexOf("--task");
  const prompt = i >= 0 ? PROMPTS[args[i + 1]] : args.find((a) => !a.startsWith("--")) ?? PROMPTS.all;
  if (!prompt) {
    console.error(`Unknown task. Use one of: ${Object.keys(PROMPTS).join(", ")}.`);
    process.exit(2);
  }
  const tend = tendHttp(agent.url, agent.key);
  try {
    const out = await runAnthropicAgent({ client: new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }), tend, env, keyInfo: agent, prompt, model: env.CLAUDE_MODEL ?? MODEL, log: console.log });
    console.log("\nTool calls:\n  " + (summarize(out.calls).join("\n  ") || "(none)"));
    console.log(`\nAgent says: ${out.finalAnswer}\n(${out.usage.calls} model calls, ${out.usage.input_tokens} in / ${out.usage.output_tokens} out tokens)`);
  } catch (e) {
    console.error(`\nFailed: ${String(e?.message ?? e).split("\n")[0]}`);
    process.exit(1);
  }
}
