#!/usr/bin/env node
// An exploratory QA agent: a real Claude model probes a disposable local TEND (an isolated production build, TEND_ADMIN=0, mails in a local
// outbox) through plain HTTP, the way a curious tester or an attacker would, and reports only what it could reproduce. It complements the
// scripted suites; it does not replace them. Nothing outside 127.0.0.1 is contacted except the Anthropic API, and the run stops at a hard
// dollar cap (QA_MAX_USD, default 0.80). The model key is read from the environment and never printed, logged or given to the server.
//
//   npm run build && ANTHROPIC_API_KEY=… node scripts/qa-agent.mjs [--out findings.json]
import "./node-check.mjs";
import Anthropic from "@anthropic-ai/sdk";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startIsolatedServer } from "./isolated-server.mjs";

const root = path.resolve(import.meta.dirname, "..");
const MODEL = process.env.QA_MODEL || "claude-opus-4-8";
const BUDGET = Number(process.env.QA_MAX_USD || "0.80");
const MAX_TURNS = Number(process.env.QA_MAX_TURNS || "45");
const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : null;
// USD per million tokens: input, output (cache writes cost 1.25x input, cache reads 0.1x).
const PRICE = { "claude-opus-4-8": [5, 25], "claude-sonnet-4-6": [3, 15], "claude-haiku-4-5": [1, 5] }[MODEL] ?? [5, 25];
if (!process.env.ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY is not set."); process.exit(2); }

const dir = mkdtempSync(path.join(tmpdir(), "tend-qa-agent-"));
let URL_ = "";
const jars = {}; // actor name -> session cookie
const keys = {}; // agent name -> API key (throwaway, for this disposable server only)
const findings = [];
let summary = null;

const clip = (s, n = 1400) => (s.length > n ? `${s.slice(0, n)}… [${s.length - n} more chars]` : s);
const hideKeys = (s) => s.replace(/tend_sk_[A-Za-z0-9_-]{12,}/g, (k) => `${k.slice(0, 14)}…`);

async function http({ method = "GET", path: p, body, as = "anon", agent, bearer, headers = {}, save_agent_as }) {
  if (typeof p !== "string" || !p.startsWith("/")) return { error: "path must start with /" };
  const h = { ...headers };
  if (body !== undefined) h["content-type"] ??= "application/json";
  if (jars[as]) h.cookie = jars[as];
  if (agent) { if (!keys[agent]) return { error: `no saved agent key named ${agent}` }; h.authorization = `Bearer ${keys[agent]}`; }
  if (bearer) h.authorization = `Bearer ${bearer}`;
  const res = await fetch(URL_ + p, { method, headers: h, redirect: "manual", body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) jars[as] = set.split(";")[0].endsWith("=") ? undefined : set.split(";")[0];
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch {}
  if (save_agent_as && parsed?.apiKey) keys[save_agent_as] = parsed.apiKey;
  return { status: res.status, ...(set && { set_cookie: set.replace(/=[^;]+/, "=<value>") }), body: clip(hideKeys(parsed ? JSON.stringify(parsed) : text)) };
}
function mail({ to }) {
  let files = [];
  try { files = readdirSync(path.join(dir, "outbox")).filter((f) => f.includes(String(to).toLowerCase())).sort(); } catch {}
  return files.length ? { count: files.length, latest: readFileSync(path.join(dir, "outbox", files.at(-1)), "utf8") } : { count: 0 };
}
const inventory = () => JSON.parse(execFileSync(process.execPath, [path.join(root, "scripts/qa-inventory.mjs"), "--json"]).toString());

const TOOLS = [
  { name: "http", description: "One HTTP request to the TEND server under test. `as` names a browser (its own cookie jar; the sign-in cookie is kept automatically). `agent` sends a saved agent API key as Bearer; `bearer` sends any string instead. `save_agent_as` stores the apiKey from a successful agent registration under that name. Bodies over 1400 characters are cut.",
    input_schema: { type: "object", properties: { method: { type: "string" }, path: { type: "string" }, body: {}, as: { type: "string" }, agent: { type: "string" }, bearer: { type: "string" }, headers: { type: "object" }, save_agent_as: { type: "string" } }, required: ["path"] } },
  { name: "mail", description: "The latest mail TEND sent to an address (the server's local outbox), with its links.", input_schema: { type: "object", properties: { to: { type: "string" } }, required: ["to"] } },
  { name: "inventory", description: "Every page, API route (methods and auth guard) and security mechanism, read from the code.", input_schema: { type: "object", properties: {} } },
  { name: "report_finding", description: "Record a defect you reproduced. Include the exact requests so a developer can repeat it.",
    input_schema: { type: "object", properties: { severity: { enum: ["critical", "high", "medium", "low"] }, area: { type: "string" }, title: { type: "string" }, steps: { type: "string" }, expected: { type: "string" }, actual: { type: "string" } }, required: ["severity", "area", "title", "steps", "expected", "actual"] } },
  { name: "done", description: "Finish: what you covered and what you did not get to.", input_schema: { type: "object", properties: { covered: { type: "array", items: { type: "string" } }, not_covered: { type: "array", items: { type: "string" } }, notes: { type: "string" } }, required: ["covered", "not_covered"] } },
];

const SYSTEM = `You are testing TEND, a security gateway that decides whether an AI agent's tool call may run (allow, deny, or ask a person first).
The server is a disposable local instance with test data only: probe it freely, including hostile input. The private-beta mode is on
(TEND_ADMIN=0): people sign up, confirm their e-mail from a mailed link, and sign in; there is no admin, and the admin routes must not exist.

How it is used:
- Accounts: POST /api/account/register {email,password}; the mail holds /account/verify#token=…; POST /api/account/verify {token,password};
  POST /api/account/sign-in {email,password}; DELETE /api/operator/session signs out; /api/account/forgot and /api/account/reset {token,password}.
- Signed in (cookie): POST /api/v1/agents {name,model,provider:"Custom"} returns {agent,apiKey}; GET/POST /api/v1/agents/{id}/policy
  {rules:[{tool,action,effect:"allow"|"deny"|"approve", when?}],enforcement:"enforce",expectedVersion}; POST /api/v1/agents/{id}/keys rotates,
  DELETE revokes; POST /api/v1/agents/{id}/control {action:"pause"|"resume"}; GET /api/v1/state; POST /api/v1/reviews/{id} {status:"approved"|"rejected"}.
- Agent key (Bearer): POST /api/v1/authorize {tool,action,resource?,args?} → 200 consumed (run it once), 202 pending, 403 denied;
  POST /api/v1/authorizations/{id}/spend with the same request after approval; POST /api/v1/events.

Your job: find real defects, especially in authentication, workspace isolation between two accounts, policy enforcement, single-use
approvals, input validation and error handling. Report a finding only after you reproduced it, with the exact requests. Expected security
behaviour (a 401/403/404 refusal, a uniform answer that hides whether an address exists, a rate limit) is not a defect. You have about
${MAX_TURNS} turns; spend them on the riskiest areas first, then call done.`;

async function main() {
  const server = await startIsolatedServer({ root, env: { TEND_ADMIN: "0", TEND_ADMIN_TOKEN: "", TEND_DATA_DIR: dir } });
  URL_ = server.url;
  const client = new Anthropic();
  const messages = [{ role: "user", content: `The server is at ${URL_}. Start.` }];
  let usd = 0, turns = 0, calls = 0;
  const cost = (u) => ((u.input_tokens ?? 0) * PRICE[0] + (u.cache_creation_input_tokens ?? 0) * PRICE[0] * 1.25 + (u.cache_read_input_tokens ?? 0) * PRICE[0] * 0.1 + (u.output_tokens ?? 0) * PRICE[1]) / 1e6;
  console.log(`QA agent: ${MODEL}, budget $${BUDGET.toFixed(2)}, up to ${MAX_TURNS} turns, server ${URL_}\n`);
  try {
    while (turns++ < MAX_TURNS && !summary) {
      if (usd > BUDGET * 0.9) { console.log(`stopping: $${usd.toFixed(3)} spent of $${BUDGET}`); break; }
      // The newest turn is the cache breakpoint, so each request re-reads the conversation from cache instead of paying for it again.
      const last = messages.at(-1);
      const content = typeof last.content === "string" ? [{ type: "text", text: last.content }] : last.content;
      content.at(-1).cache_control = { type: "ephemeral" };
      last.content = content;
      const res = await client.messages.create({ model: MODEL, max_tokens: 4000, system: SYSTEM, tools: TOOLS, messages, thinking: { type: "adaptive" }, output_config: { effort: "medium" } });
      for (const m of messages) if (Array.isArray(m.content)) for (const b of m.content) delete b.cache_control;
      usd += cost(res.usage);
      messages.push({ role: "assistant", content: res.content });
      const uses = res.content.filter((b) => b.type === "tool_use");
      if (res.stop_reason === "refusal" || !uses.length) { console.log(`model stopped (${res.stop_reason})`); break; }
      const results = [];
      for (const u of uses) {
        calls++;
        let r;
        try {
          if (u.name === "http") r = await http(u.input);
          else if (u.name === "mail") r = mail(u.input);
          else if (u.name === "inventory") r = inventory();
          else if (u.name === "report_finding") { findings.push(u.input); r = { recorded: findings.length }; console.log(`  FINDING [${u.input.severity}] ${u.input.title}`); }
          else if (u.name === "done") { summary = u.input; r = { ok: true }; }
          else r = { error: "unknown tool" };
        } catch (e) { r = { error: String(e.message ?? e) }; }
        if (u.name === "http") console.log(`  ${String(u.input.method ?? "GET").padEnd(6)} ${u.input.path} → ${r.status ?? r.error}${u.input.as ? ` (as ${u.input.as})` : ""}${u.input.agent ? ` (agent ${u.input.agent})` : ""}`);
        results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(r) });
      }
      messages.push({ role: "user", content: results });
    }
  } finally {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  }
  const report = { model: MODEL, usd: Number(usd.toFixed(4)), turns: turns - 1, toolCalls: calls, findings, summary };
  if (out) writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\n${findings.length} findings, ${calls} tool calls, ${turns - 1} turns, $${usd.toFixed(3)}`);
  if (summary) console.log(`covered: ${summary.covered.join("; ")}\nnot covered: ${summary.not_covered.join("; ")}`);
}
main().catch((e) => { console.error(String(e.message ?? e).replaceAll(process.env.ANTHROPIC_API_KEY, "[redacted]")); process.exit(1); });
