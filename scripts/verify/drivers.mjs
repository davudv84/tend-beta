// One driver per integration for scripts/verify-integrations.mjs. A driver connects the real thing (model, framework or host) to TEND
// through the shared adapters, sends one prompt, and returns what the agent tried and what it cost. It never decides a verdict: the
// harness does that from TEND's records and the ledger. requires() lists what is missing; anything listed makes the integration BLOCKED.
//
//   run({ url, key, prompt, system, ledger, dir }) => { attempts?, usd, final, error? }
// In-process drivers record each attempt in the ledger before asking TEND; the tool body writes "ran" only when it really runs.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { guardTool } from "../../examples/adapters/guard.mjs";
import { PROVIDERS, runChatAgent } from "../../examples/adapters/openai-compatible.mjs";
import { connectTend } from "../../examples/claude-quickstart/tend-client.mjs";
import { NOTE_TOOLS, runNoteTool } from "../../examples/mcp-proxy/notes-server.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const HAIKU = "claude-haiku-4-5";
const haikuUsd = (i, o) => (i * 1.0 + o * 5.0) / 1e6; // Claude Haiku 4.5 list price, USD per million tokens
const env = (k) => process.env[k] ?? "";
const needKey = (k) => (env(k) ? [] : [`${k} (an API key for this provider, in the environment)`]);
const has = (cmd) => spawnSync("/bin/sh", ["-c", `command -v ${cmd}`]).status === 0;
const venvPython = (framework) => path.join(root, `.verify/py-${framework}/bin/python`); // one environment per framework: their pins conflict
const FRAMEWORKS = path.join(root, "scripts/verify/frameworks");

/** The three note tools, each wrapped so it runs only on TEND's yes, with every attempt written to the ledger first. */
export function noteTools(gate, ledger) {
  return NOTE_TOOLS.map((t) => {
    const guarded = guardTool(gate, t.name, (args) => runNoteTool(t.name, args, ledger));
    return { ...t, run: async (args) => (appendFileSync(ledger, `${JSON.stringify({ ev: "attempt", tool: t.name })}\n`), guarded(args)) };
  });
}
const gateFor = (url, key) => connectTend({ url, key, retries: 0, pollMs: 300, approvalTimeoutMs: 90_000 });

/** A provider reached through the OpenAI-compatible adapter. */
const chat = (id, provider, model, label, tendProvider, extra = () => []) => ({
  id, provider: tendProvider, model, label,
  requires: async () => [...(PROVIDERS[provider].keyEnv ? needKey(PROVIDERS[provider].keyEnv) : []), ...(await extra())],
  run: async ({ url, key, prompt, system, ledger }) => {
    const r = await runChatAgent({ provider, model, tools: noteTools(gateFor(url, key), ledger), system, prompt });
    return { final: r.final, error: r.error, usd: provider === "anthropic" ? haikuUsd(r.usage.in, r.usage.out) : provider === "ollama" ? 0 : null };
  },
});

/** A host that starts MCP stdio servers: its config points at TEND's MCP proxy, which starts the harmless notes server. */
const mcpConfig = (url, key, ledger) => ({
  mcpServers: {
    tend: {
      command: process.execPath,
      args: [path.join(root, "examples/mcp-proxy/tend-mcp-proxy.mjs"), "--", process.execPath, path.join(root, "examples/mcp-proxy/notes-server.mjs"), ledger],
      env: { TEND_URL: url, TEND_AGENT_KEY: key, TEND_APPROVAL_TIMEOUT_MS: "90000" },
    },
  },
});

/** Claude Code, headless: no built-in tools, no user settings, hooks or memory (--bare), only the TEND MCP server, its own API key. */
async function runClaudeCode({ url, key, prompt, system, ledger, dir }) {
  const home = path.join(dir, "cc-home");
  mkdirSync(home, { recursive: true });
  const cfg = path.join(dir, "cc-mcp.json");
  writeFileSync(cfg, JSON.stringify(mcpConfig(url, key, ledger)));
  const argv = ["--bare", "-p", "--model", HAIKU, "--append-system-prompt", system, "--tools", "", "--strict-mcp-config", "--mcp-config", cfg,
    "--allowedTools", "mcp__tend__read_note,mcp__tend__delete_note,mcp__tend__send_note", "--output-format", "stream-json", "--verbose", "--no-session-persistence", "--max-budget-usd", "0.25"];
  const child = spawn("claude", argv, { cwd: dir, stdio: ["pipe", "pipe", "pipe"], env: { PATH: env("PATH"), HOME: home, TMPDIR: env("TMPDIR"), ANTHROPIC_API_KEY: env("ANTHROPIC_API_KEY"), MCP_TOOL_TIMEOUT: "120000", MCP_TIMEOUT: "30000" } });
  child.stdin.end(prompt);
  let buf = "", err = "";
  child.stdout.on("data", (d) => (buf += d));
  child.stderr.on("data", (d) => (err += d));
  const code = await new Promise((r) => child.on("close", r));
  const attempts = [];
  let usd = 0, final = "", isError = false;
  for (const line of buf.split("\n")) {
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (m.type === "assistant") for (const c of m.message?.content ?? []) if (c.type === "tool_use" && c.name?.startsWith("mcp__tend__")) attempts.push(c.name.slice("mcp__tend__".length));
    if (m.type === "result") { usd = m.total_cost_usd ?? 0; final = m.result ?? ""; isError = m.is_error; }
  }
  return { attempts, usd, final, ...((code !== 0 && !attempts.length) || (isError && !attempts.length) ? { error: `claude exited ${code}: ${(final || err).slice(0, 160)}` } : {}) };
}

/** Python drivers (stdlib TEND client in examples/python/tend_gate.py): the HTTP API from a second language, and the Python frameworks. */
const python = (id, framework, label, tendProvider, needsVenv = true) => ({
  id, provider: tendProvider, model: HAIKU, label,
  requires: async () => [...needKey("ANTHROPIC_API_KEY"), ...(needsVenv && !existsSync(venvPython(framework)) ? [`the ${framework} environment (npm run verify:setup)`] : [])],
  run: ({ url, key, prompt, system, ledger }) => runJson(needsVenv ? venvPython(framework) : "python3", ["-I", path.join(root, "scripts/verify/py_driver.py"), framework], { url, key, prompt, system, ledger }),
});
/** A JavaScript framework driver from scripts/verify/frameworks (its own package, so the app gets no new dependency). */
const jsFramework = (id, label, tendProvider) => ({
  id, provider: tendProvider, model: HAIKU, label,
  requires: async () => [...needKey("ANTHROPIC_API_KEY"), ...(existsSync(path.join(FRAMEWORKS, "node_modules")) ? [] : ["the JavaScript frameworks packages (npm run verify:setup)"])],
  run: ({ url, key, prompt, system, ledger }) => runJson(process.execPath, [path.join(FRAMEWORKS, "js-driver.mjs"), id], { url, key, prompt, system, ledger }),
});
/** A child process that gets the job as JSON on stdin and answers with one JSON line; the provider key reaches it only through its environment. */
async function runJson(cmd, argv, job) {
  const child = spawn(cmd, argv, { stdio: ["pipe", "pipe", "pipe"], env: { PATH: env("PATH"), HOME: env("HOME"), TMPDIR: env("TMPDIR"), ANTHROPIC_API_KEY: env("ANTHROPIC_API_KEY"), CREWAI_TELEMETRY_OPT_OUT: "true", OTEL_SDK_DISABLED: "true", ANONYMIZED_TELEMETRY: "false", MASTRA_TELEMETRY_DISABLED: "1" } });
  child.stdin.end(JSON.stringify(job));
  let out = "", err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  const code = await new Promise((r) => child.on("close", r));
  const last = out.trim().split("\n").at(-1);
  try { return JSON.parse(last); } catch { return { error: `driver exited ${code}: ${(err || out).trim().split("\n").at(-1)?.slice(0, 200)}` }; }
}

const notInstalled = (id, label, what) => ({ id, provider: "Custom", label, requires: async () => what() });

export const DRIVERS = [
  {
    id: "claude", provider: "Anthropic", model: HAIKU, label: `${HAIKU} via the official Anthropic SDK (@anthropic-ai/sdk)`,
    requires: async () => needKey("ANTHROPIC_API_KEY"),
    run: async ({ url, key, prompt, system, ledger }) => {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: env("ANTHROPIC_API_KEY"), maxRetries: 1 });
      const tools = noteTools(gateFor(url, key), ledger);
      const messages = [{ role: "user", content: prompt }];
      let i = 0, o = 0, final = "";
      for (let turn = 0; turn < 4; turn++) {
        const r = await client.messages.create({ model: HAIKU, max_tokens: 400, system, messages, tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: { type: "object", properties: Object.fromEntries(Object.entries(t.params).map(([k, d]) => [k, { type: "string", description: d }])), required: Object.keys(t.params) } })) });
        i += r.usage.input_tokens; o += r.usage.output_tokens;
        messages.push({ role: "assistant", content: r.content });
        const uses = r.content.filter((c) => c.type === "tool_use");
        if (!uses.length) { final = r.content.filter((c) => c.type === "text").map((c) => c.text).join(" "); break; }
        messages.push({ role: "user", content: await Promise.all(uses.map(async (u) => ({ type: "tool_result", tool_use_id: u.id, content: String(await tools.find((t) => t.name === u.name)?.run(u.input) ?? "No such tool.") }))) });
      }
      return { final, usd: haikuUsd(i, o) };
    },
  },
  python("http", "http", "TEND's HTTP API from Python with only the standard library (examples/python/tend_gate.py); Claude Haiku 4.5 over the raw Messages API", "Custom", false),
  chat("openaiApi", "openai", env("OPENAI_MODEL") || "gpt-4.1-mini", "OpenAI's Chat Completions API through the OpenAI-compatible adapter", "OpenAI"),
  chat("gemini", "gemini", env("GEMINI_MODEL") || "gemini-2.5-flash", "Google Gemini's OpenAI-compatible endpoint through the OpenAI-compatible adapter", "Google"),
  chat("mistral", "mistral", env("MISTRAL_MODEL") || "mistral-small-latest", "Mistral's API through the OpenAI-compatible adapter", "Custom"),
  chat("groq", "groq", env("GROQ_MODEL") || "llama-3.3-70b-versatile", "Groq's OpenAI-compatible endpoint through the OpenAI-compatible adapter", "Custom"),
  chat("ollama", "ollama", env("OLLAMA_MODEL") || "qwen2.5:7b-instruct", "a local model (qwen2.5 7B) in Ollama through its OpenAI-compatible endpoint", "Custom",
    async () => ((await fetch("http://127.0.0.1:11434/api/version").then((r) => r.ok, () => false)) ? [] : ["a running Ollama (ollama serve) with the model pulled (ollama pull qwen2.5:7b-instruct)"])),
  chat("openaiCompatible", "anthropic", HAIKU, `the OpenAI-compatible adapter against Anthropic's OpenAI-compatible endpoint (${HAIKU})`, "Custom"),
  {
    id: "openai", provider: "OpenAI", model: HAIKU, label: `the official OpenAI Agents SDK (@openai/agents) driving ${HAIKU} through Anthropic's OpenAI-compatible endpoint (no OpenAI key available)`,
    requires: async () => needKey("ANTHROPIC_API_KEY"),
    run: async ({ url, key, prompt, system, ledger }) => {
      const { Agent, run, setDefaultOpenAIClient, setOpenAIAPI, setTracingDisabled, tool } = await import("@openai/agents");
      const { default: OpenAI } = await import("openai");
      const { z } = await import("zod");
      setTracingDisabled(true);
      setOpenAIAPI("chat_completions");
      setDefaultOpenAIClient(new OpenAI({ apiKey: env("ANTHROPIC_API_KEY"), baseURL: `${PROVIDERS.anthropic.baseURL}/` }));
      const tools = noteTools(gateFor(url, key), ledger).map((t) => tool({ name: t.name, description: t.description, parameters: z.object(Object.fromEntries(Object.keys(t.params).map((k) => [k, z.string()]))), execute: (input) => t.run(input) }));
      const result = await run(new Agent({ name: "TEND verification agent", instructions: system, model: HAIKU, tools }), prompt, { maxTurns: 4 });
      const u = result.state?.usage ?? {};
      return { final: String(result.finalOutput ?? ""), usd: haikuUsd(u.inputTokens ?? 0, u.outputTokens ?? 0) };
    },
  },
  {
    id: "claudeCode", provider: "Custom", model: HAIKU, label: `Claude Code ${spawnSync("claude", ["--version"]).stdout?.toString().trim().split(" ")[0] ?? ""} headless (claude -p --bare, ${HAIKU}) with TEND's MCP proxy as its only MCP server`,
    requires: async () => [...needKey("ANTHROPIC_API_KEY"), ...(has("claude") ? [] : ["Claude Code (the claude command)"])],
    run: runClaudeCode,
  },
  { id: "mcp", sameAs: "claudeCode", label: "the MCP proxy with a real MCP host (Claude Code) and a real MCP stdio server (examples/mcp-proxy/notes-server.mjs)" },
  notInstalled("cursor", "Cursor through TEND's MCP proxy", () => (has("cursor-agent") ? ["a Cursor driver (not written yet: cursor-agent was not installed when this suite was built)"] : ["Cursor's headless agent CLI (cursor-agent, from cursor.com/cli) signed in to a Cursor account; Cursor.app alone cannot be driven by a test"])),
  notInstalled("cline", "Cline through TEND's MCP proxy", () => [has("cline") ? "a Cline driver (not written yet: the Cline CLI was not installed when this suite was built)" : "the Cline CLI (npm install -g cline) with a model provider configured"]),
  notInstalled("hermes", "Hermes Agent through TEND's MCP proxy (mcp_servers in ~/.hermes/config.yaml)", () => [has("hermes") ? "a Hermes Agent driver (not written yet: Hermes Agent was not installed when this suite was built)" : "Hermes Agent installed (its installer runs a remote script: needs your review and approval) with a model provider configured"]),
  notInstalled("openclaw", "OpenClaw through TEND's MCP proxy (openclaw mcp add)", () => [has("openclaw") ? "an OpenClaw driver (not written yet: OpenClaw was not installed when this suite was built)" : "OpenClaw installed and its gateway configured with a model provider (needs your review and approval)"]),
  jsFramework("langchain", `LangChain JS (createAgent from langchain) with ChatAnthropic, ${HAIKU}`, "Anthropic"),
  jsFramework("langgraph", `LangGraph JS (createReactAgent) with ChatAnthropic, ${HAIKU}`, "Anthropic"),
  jsFramework("mastra", `Mastra (@mastra/core Agent) with ${HAIKU}`, "Anthropic"),
  python("pydanticAi", "pydantic_ai", `PydanticAI Agent with ${HAIKU}`, "Anthropic"),
  python("autogen", "autogen", `AutoGen AgentChat AssistantAgent with ${HAIKU}`, "Anthropic"),
  python("crewai", "crewai", `CrewAI Crew with ${HAIKU} (CrewAI's native Anthropic provider)`, "Anthropic"),
];
