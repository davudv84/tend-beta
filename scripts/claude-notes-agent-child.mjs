#!/usr/bin/env node
// One real Claude notes agent run, as its own process (started by scripts/claude-notes-e2e.mjs). It is the shipped agent,
// examples/claude-agent/notes-agent.mjs, with a real Claude model: its only tools are Tend's gateway note tools, it has no
// filesystem access and no path. Its whole environment is five variables, none of them a Tend server secret:
//   TEND_URL, TEND_AGENT_KEY, ANTHROPIC_API_KEY, NOTES_PROMPT, and optionally MAX_USD and APPROVAL_TIMEOUT_MS.
// runNotesAgent refuses to start if the environment holds server secrets. Progress goes to stderr; the answer is one stdout line:
// `RESULT {json}`. Nothing printed contains a key or token.
import { tendHttp } from "../examples/claude-agent/agent.mjs";
import { notesAnthropic, runNotesAgent } from "../examples/claude-agent/notes-agent.mjs";

const { TEND_URL, TEND_AGENT_KEY, ANTHROPIC_API_KEY, NOTES_PROMPT, MAX_USD = "0.2", APPROVAL_TIMEOUT_MS = "60000" } = process.env;
if (!TEND_URL || !TEND_AGENT_KEY || !ANTHROPIC_API_KEY || !NOTES_PROMPT) {
  console.error("Missing TEND_URL, TEND_AGENT_KEY, ANTHROPIC_API_KEY or NOTES_PROMPT.");
  process.exit(2);
}

const claude = notesAnthropic({ apiKey: ANTHROPIC_API_KEY, maxUsd: Number(MAX_USD) });
let out, error;
try {
  out = await runNotesAgent({
    model: claude.call,
    tend: tendHttp(TEND_URL, TEND_AGENT_KEY, { timeoutMs: 15_000 }),
    prompt: NOTES_PROMPT,
    approvalTimeoutMs: Number(APPROVAL_TIMEOUT_MS),
    pollMs: 300,
    log: (line) => console.error(line),
    source: "real-model",
    env: process.env,
  });
} catch (e) {
  error = String(e?.message ?? e).slice(0, 300);
}
const calls = out?.calls?.map(({ tool, input, executed, outcome, reason, authorizationId, result }) => ({ tool, input, executed, outcome, reason, authorizationId, result }));
console.log(`RESULT ${JSON.stringify({ ok: !error, error, calls, turns: out?.turns, finalAnswer: out?.finalAnswer, usage: claude.usage })}`);
process.exit(error ? 1 : 0);
