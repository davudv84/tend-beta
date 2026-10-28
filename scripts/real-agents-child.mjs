#!/usr/bin/env node
// One real provider run as its own process (started by scripts/real-agents-e2e.mjs). It is the shipped example agent
// (examples/real-agents) and nothing else. Its whole environment is a handful of variables, none of them a TEND server secret:
//   PROVIDER (openai|anthropic), PROMPT, TEND_URL, TEND_AGENT_KEY, OPENAI_API_KEY or ANTHROPIC_API_KEY, optionally MODEL, APPROVAL_TIMEOUT_MS.
// Progress goes to stderr. The answer is one stdout line, `RESULT {json}`; it contains no key or token.
import Anthropic from "@anthropic-ai/sdk";
import { runAnthropicAgent } from "../examples/real-agents/anthropic-agent.mjs";
import { runOpenAIAgent } from "../examples/real-agents/openai-agent.mjs";
import { tendHttp } from "../examples/real-agents/toolbox.mjs";

const { PROVIDER, PROMPT, TEND_URL, TEND_AGENT_KEY, MODEL, APPROVAL_TIMEOUT_MS = "60000" } = process.env;
if (!PROVIDER || !PROMPT || !TEND_URL || !TEND_AGENT_KEY) {
  console.error("Missing PROVIDER, PROMPT, TEND_URL or TEND_AGENT_KEY.");
  process.exit(2);
}
const common = { tend: tendHttp(TEND_URL, TEND_AGENT_KEY, { timeoutMs: 15_000 }), env: process.env, prompt: PROMPT, approvalTimeoutMs: Number(APPROVAL_TIMEOUT_MS), pollMs: 300, log: (l) => console.error(l), ...(MODEL && { model: MODEL }) };
let out, error;
try {
  out = PROVIDER === "openai" ? await runOpenAIAgent(common) : await runAnthropicAgent({ ...common, client: new Anthropic() });
} catch (e) {
  error = String(e?.message ?? e).split("\n")[0].slice(0, 300);
}
console.log(`RESULT ${JSON.stringify({ ok: !error, error, calls: out?.calls, finalAnswer: out?.finalAnswer, usage: out?.usage })}`);
process.exit(error ? 1 : 0);
