// JavaScript framework drivers for scripts/verify-integrations.mjs: LangChain, LangGraph and Mastra, each given the same three note tools,
// each tool body wrapped by guardTool() so it runs only on TEND's yes. Job as JSON on stdin; one JSON line out: { final, usd } or { error }.
import { z } from "zod";
import { connectTend } from "../../../examples/claude-quickstart/tend-client.mjs";
import { noteTools } from "../drivers.mjs";

const MODEL = "claude-haiku-4-5";
const usd = (i, o) => (i * 1.0 + o * 5.0) / 1e6; // Claude Haiku 4.5 list price, USD per million tokens
const shape = (t) => z.object(Object.fromEntries(Object.entries(t.params).map(([k, d]) => [k, z.string().describe(d)])));
const tokens = (messages) => messages.reduce((u, m) => ({ i: u.i + (m.usage_metadata?.input_tokens ?? 0), o: u.o + (m.usage_metadata?.output_tokens ?? 0) }), { i: 0, o: 0 });
const lastText = (messages) => String(messages.at(-1)?.content ?? "");

const DRIVERS = {
  async langchain(job, tools) {
    const { createAgent, tool } = await import("langchain");
    const { ChatAnthropic } = await import("@langchain/anthropic");
    const agent = createAgent({ model: new ChatAnthropic({ model: MODEL, maxTokens: 400 }), systemPrompt: job.system, tools: tools.map((t) => tool((input) => t.run(input), { name: t.name, description: t.description, schema: shape(t) })) });
    const r = await agent.invoke({ messages: [{ role: "user", content: job.prompt }] }, { recursionLimit: 8 });
    const u = tokens(r.messages);
    return { final: lastText(r.messages), usd: usd(u.i, u.o) };
  },
  async langgraph(job, tools) {
    const { createReactAgent } = await import("@langchain/langgraph/prebuilt");
    const { tool } = await import("@langchain/core/tools");
    const { ChatAnthropic } = await import("@langchain/anthropic");
    const agent = createReactAgent({ llm: new ChatAnthropic({ model: MODEL, maxTokens: 400 }), prompt: job.system, tools: tools.map((t) => tool((input) => t.run(input), { name: t.name, description: t.description, schema: shape(t) })) });
    const r = await agent.invoke({ messages: [{ role: "user", content: job.prompt }] }, { recursionLimit: 8 });
    const u = tokens(r.messages);
    return { final: lastText(r.messages), usd: usd(u.i, u.o) };
  },
  async mastra(job, tools) {
    const { Agent } = await import("@mastra/core/agent");
    const { createTool } = await import("@mastra/core/tools");
    // Mastra passes the validated input as the first argument (older releases wrapped it as { context }).
    const mtools = Object.fromEntries(tools.map((t) => [t.name, createTool({ id: t.name, description: t.description, inputSchema: shape(t), execute: async (input) => t.run(input?.context ?? input) })]));
    const agent = new Agent({ name: "tend-verifier", instructions: job.system, model: `anthropic/${MODEL}`, tools: mtools });
    const r = await agent.generate(job.prompt, { maxSteps: 4 });
    const u = r.totalUsage ?? r.usage ?? {};
    return { final: String(r.text ?? ""), usd: usd(u.inputTokens ?? u.promptTokens ?? 0, u.outputTokens ?? u.completionTokens ?? 0) };
  },
};

let input = "";
for await (const c of process.stdin) input += c;
const job = JSON.parse(input);
let result;
try {
  const tools = noteTools(connectTend({ url: job.url, key: job.key, retries: 0, pollMs: 300, approvalTimeoutMs: 90_000 }), job.ledger);
  result = await DRIVERS[process.argv[2]](job, tools);
} catch (e) {
  result = { error: `${e.name}: ${String(e.message).slice(0, 200)}` };
}
process.stdout.write(`\n${JSON.stringify(result)}\n`);
process.exit(0);
