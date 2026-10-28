#!/usr/bin/env node
// A Claude agent whose *only* tools are Tend gateway note tools. It never imports `fs` and has no other
// execution path. File operations run inside Tend after a single-use authorization.
//
//   TEND_URL=… TEND_AGENT_KEY=… ANTHROPIC_API_KEY=… node examples/claude-agent/notes-agent.mjs
//   … node examples/claude-agent/notes-agent.mjs --scripted     # no model calls
//
// Real vs simulated: without --scripted this calls Anthropic `claude-haiku-4-5`. With --scripted a
// playback decides the tool calls. Tend, the gateway and the dashboard are always real for that process.
import { costOf, MODEL as DEFAULT_MODEL, tendHttp } from "./agent.mjs";
import { createGateway } from "./gateway-client.mjs";
import { assertEnforced, assertNoDirectAccess } from "./isolation.mjs";

export const MODEL = process.env.CLAUDE_MODEL ?? DEFAULT_MODEL;
export const MAX_TURNS = 8;
export const MAX_TOKENS = 400;

export const NOTES_TOOLS = [
  {
    name: "list_notes",
    description: "List the short note files the gateway can see. Returns comma-separated names without .txt.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "read_note",
    description: "Read one note by its name (no path, no extension).",
    input_schema: { type: "object", properties: { name: { type: "string", description: "1-32 of a-z, 0-9 and hyphens." } }, required: ["name"] },
  },
  {
    name: "write_note",
    description: "Create a new note. Cannot overwrite. The gateway writes the file after human approval.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "1-32 of a-z, 0-9 and hyphens." },
        text: { type: "string", description: "1-160 printable ASCII characters, one line." },
      },
      required: ["name", "text"],
    },
  },
];

export const NOTES_PROMPT = "There are a few mixed notes in the notes store (meetings, errands, ideas). List them, read each one, then write a new note named inbox-summary that groups them in a few short lines. Use only the tools you have. If a tool is refused, say so and stop trying to go around it.";

export const NOTES_PLAN = [
  [["list_notes", {}]],
  [["read_note", { name: "standup" }]],
  [["read_note", { name: "printer" }]],
  [["read_note", { name: "garden" }]],
  [["write_note", { name: "inbox-summary", text: "Meetings: Anna owns Q4. Errands: order printer paper. Ideas: plant herbs by the north wall." }]],
];

const SYSTEM = "You are a test agent for monitoring software. All notes are fictional. Your only abilities are list_notes, read_note and write_note; each is executed by a supervised gateway and may need a human to approve it. Do not claim you wrote a file unless a tool result says so. Keep the final answer to one or two sentences.";

export function scriptedNotesModel() {
  return async (messages) => {
    const turn = messages.filter((m) => m.role === "assistant").length;
    const calls = NOTES_PLAN[turn];
    if (!calls) return { stop_reason: "end_turn", content: [{ type: "text", text: "Done. inbox-summary is written." }] };
    return { stop_reason: "tool_use", content: calls.map(([name, input], i) => ({ type: "tool_use", id: `tu_${turn}_${i}`, name, input })) };
  };
}

export function notesAnthropic({ apiKey, model = MODEL, maxUsd = 0.5 }) {
  const usage = { calls: 0, input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, usd: 0 };
  async function call(messages) {
    if (usage.usd >= maxUsd) throw new Error(`Budget reached: $${usage.usd.toFixed(4)} of $${maxUsd}`);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: MAX_TOKENS, system: SYSTEM, tools: NOTES_TOOLS, messages }),
      signal: AbortSignal.timeout(60_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Claude API ${res.status}: ${body.error?.type ?? "error"}: ${body.error?.message ?? ""}`);
    usage.calls++;
    for (const k of ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"]) usage[k] += body.usage?.[k] ?? 0;
    usage.usd = costOf(usage, model);
    return body;
  }
  return { call, usage };
}

const GATEWAY_TOOLS = new Set(NOTES_TOOLS.map((t) => t.name));

/**
 * Runs one organize-notes task. `model` is either the real Messages API or scriptedNotesModel.
 * Every tool_use goes through the gateway client; unknown tool names are refused locally without I/O.
 * `env` is the agent process's environment: when given, the run is refused if it holds gateway credentials or Tend
 * server secrets (the CLI and the demo always pass it). The run is also refused unless Tend has the agent in enforce mode.
 */
export async function runNotesAgent({ model, tend, prompt = NOTES_PROMPT, approvalTimeoutMs = 120_000, pollMs = 2_000, onPending, log = () => {}, source = "scripted", env }) {
  if (env) assertNoDirectAccess(env);
  const inbox = await tend("/api/v1/agent/inbox");
  assertEnforced(inbox.config);
  if (!inbox.config.integrationEnabled || inbox.config.status === "paused") throw new Error("A human has paused or disabled this agent in Tend.");
  await tend("/api/v1/events", { type: "config.acknowledged", data: { version: inbox.config.version } });

  const gateway = createGateway({ tend, approvalTimeoutMs, pollMs, onPending, log });
  const calls = [];
  const taskId = `notes-${Date.now().toString(36)}`;
  await tend("/api/v1/events", { type: "task.started", data: { taskId, title: "Organize notes" } });

  const messages = [{ role: "user", content: prompt }];
  let turns = 0, stop = null, failed = null, finalAnswer = "";
  try {
    while (turns < MAX_TURNS) {
      turns++;
      const res = await model(messages);
      messages.push({ role: "assistant", content: res.content });
      stop = res.stop_reason;
      if (res.stop_reason !== "tool_use") {
        finalAnswer = (res.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
        break;
      }
      const results = [];
      for (const block of res.content.filter((b) => b.type === "tool_use")) {
        log(`[${source}] tool_use ${block.name} ${JSON.stringify(block.input ?? {})}`);
        let out;
        if (!GATEWAY_TOOLS.has(block.name)) {
          out = { executed: false, outcome: "refused", reason: "unknown_tool" };
        } else {
          out = await gateway.run(block.name, block.input ?? {});
        }
        calls.push({ tool: block.name, input: block.input ?? {}, ...out });
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(out.executed ? out.result : { error: `Not executed (${out.outcome}${out.reason ? `: ${out.reason}` : ""}).` }),
          ...(!out.executed && { is_error: true }),
        });
      }
      messages.push({ role: "user", content: results });
    }
  } catch (e) {
    failed = e;
  }
  await tend("/api/v1/events", failed
    ? { type: "task.failed", data: { taskId, error: String(failed.message).slice(0, 200) } }
    : { type: "task.completed", data: { taskId, summary: `${calls.length} gateway call${calls.length === 1 ? "" : "s"}` } });
  if (failed) throw failed;
  await tend("/api/v1/events", { type: "agent.idle" });
  return { calls, turns, stop, finalAnswer, source };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const scripted = process.argv.includes("--scripted");
  const { TEND_URL = "http://localhost:3000", TEND_AGENT_KEY, ANTHROPIC_API_KEY, MAX_USD = "0.5", APPROVAL_TIMEOUT_MS = "600000" } = process.env;
  if (!TEND_AGENT_KEY) {
    console.error("Set TEND_AGENT_KEY.");
    process.exit(1);
  }
  if (!scripted && !ANTHROPIC_API_KEY) {
    console.error("Set ANTHROPIC_API_KEY, or pass --scripted for a playback with no model calls.");
    process.exit(1);
  }
  const source = scripted ? "scripted" : "real-model";
  const claude = scripted ? null : notesAnthropic({ apiKey: ANTHROPIC_API_KEY, maxUsd: Number(MAX_USD) });
  const out = await runNotesAgent({
    model: scripted ? scriptedNotesModel() : claude.call,
    tend: tendHttp(TEND_URL, TEND_AGENT_KEY),
    env: process.env,
    approvalTimeoutMs: Number(APPROVAL_TIMEOUT_MS),
    log: console.log,
    source,
    onPending: ({ authorizationId, tool, detail }) => {
      console.log(`\n[waiting on dashboard] ${tool} ${authorizationId}\n  ${detail ?? ""}\n  Approve or reject under Oversight → Authorizations. The agent continues on its own after you decide.\n`);
    },
  });
  console.log(JSON.stringify({ ...out, usage: claude?.usage ?? null }, null, 2));
}
