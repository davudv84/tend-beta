#!/usr/bin/env node
// `npm run demo:cross`: ONE policy controlling a Claude agent and an OpenAI agent, each with its own key, in one audit history.
//
// It starts a throwaway TEND, registers two independent agents (the shipped example agents: Anthropic SDK and OpenAI Agents SDK, each its
// own process holding only its own TEND key), and then:
//   round 1   one central policy (read: allow, write: ask, delete: never) is applied to both; each agent reads, writes (this script approves) and tries to delete
//   round 2   the policy is changed ONCE (write: never); the same agents with the same keys and the same code now cannot write, and nobody is asked
//   audit     both agents' actions and both policy changes, in the one log TEND keeps
//   revoke    the Claude agent's key is revoked; its next run is refused; the OpenAI agent is unaffected and still obeys the policy
// A provider with ANTHROPIC_API_KEY / OPENAI_API_KEY in the environment runs a REAL model (cents); a provider without one is played by a scripted
// stand-in and says so. TEND is real either way. Keys are never printed and never reach the TEND server. The sign-in token stays in memory.
//
//   npm run demo:cross                 real models for the providers whose key is set, stand-ins for the rest
//   npm run demo:cross -- --scripted   stand-ins for both (no key, no cost)
import "./node-check.mjs";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { keyPrefix } from "../examples/real-agents/env.mjs";
import { ensureBuilt } from "./ensure-built.mjs";
import { fakeAnthropic, fakeOpenAI } from "./fake-models.mjs";
import { startIsolatedServer } from "./isolated-server.mjs";

const root = path.resolve(import.meta.dirname, "..");
const t0 = Date.now();
const scripted = process.argv.includes("--scripted");
const PROVIDERS = {
  anthropic: { label: "Claude agent", provider: "Anthropic", model: process.env.CLAUDE_MODEL ?? "claude-haiku-4-5", keyVar: "ANTHROPIC_API_KEY", fake: fakeAnthropic, price: [1.0, 5.0] },
  openai: { label: "OpenAI agent", provider: "OpenAI", model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini", keyVar: "OPENAI_API_KEY", fake: fakeOpenAI, price: [0.4, 1.6] }, // approximate list prices, USD per million tokens
};
for (const p of Object.values(PROVIDERS)) p.real = !scripted && !!process.env[p.keyVar];
const BUDGET = Number(process.env.MAX_USD ?? "1");
const ADMIN = `demo_${randomBytes(24).toString("base64url")}`; // in memory only
const secrets = [ADMIN, ...Object.values(PROVIDERS).map((p) => process.env[p.keyVar]).filter(Boolean)];
const scrub = (s) => secrets.reduce((t, x) => t.split(x).join("[hidden]"), String(s));
const say = (s = "") => console.log(scrub(s));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the policy, written once -------------------------------------------------------------------------------------------------------
const POLICY_V1 = [
  { tool: "read_test_file", action: "read", effect: "allow" },
  { tool: "write_test_file", action: "create", effect: "approve" },
  { tool: "delete_test_file", action: "delete", effect: "deny" },
];
const POLICY_V2 = POLICY_V1.map((r) => (r.tool === "write_test_file" ? { ...r, effect: "deny" } : r));
const promptAll = (file) => `Read the file hello.txt. Then create a file named ${file} containing one short line that summarizes hello.txt. Then try to delete hello.txt. Finally tell me exactly which of the three actions succeeded.`;
const PROMPT_READ = "Read the file hello.txt and tell me what it says.";
const scriptAll = (file) => ({ turns: [[{ name: "read_test_file", input: { path: "hello.txt" } }], [{ name: "write_test_file", input: { path: file, text: "hello.txt says the picnic is on Friday." } }], [{ name: "delete_test_file", input: { path: "hello.txt" } }]], final: "(scripted) I tried to read, write and delete; the tool results say which happened." });
const scriptRead = { turns: [[{ name: "read_test_file", input: { path: "hello.txt" } }]], final: "(scripted) I read hello.txt." };

// ---- server and operator -----------------------------------------------------------------------------------------------------------
let server, dataDir, sandbox, URL_ = "", cookie = "";
const cleanup = async () => { await server?.stop().catch(() => {}); for (const d of [dataDir, sandbox]) if (d) rmSync(d, { recursive: true, force: true }); };
process.on("SIGINT", async () => { await cleanup(); process.exit(130); });
async function op(method, p, body) {
  const res = await fetch(URL_ + p, { method, headers: { ...(body !== undefined && { "content-type": "application/json" }), cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}
const state = async () => (await op("GET", "/api/v1/state")).body.projection;

let spent = 0;
const usd = (p, u) => ((u?.input_tokens ?? u?.inputTokens ?? 0) * p.price[0] + (u?.output_tokens ?? u?.outputTokens ?? 0) * p.price[1]) / 1e6;

/** One run of the shipped example agent for a provider, as its own process holding only its own TEND key. `decide(a)` answers a held request. */
async function runAgent(name, agent, prompt, script, decide = () => "rejected") {
  const p = PROVIDERS[name];
  if (spent >= BUDGET) return { result: { ok: false, error: "budget cap reached" }, decisions: [] };
  const fake = p.real ? null : await p.fake(script);
  const env = { PATH: process.env.PATH ?? "", TMPDIR: tmpdir(), LC_ALL: "C", PROVIDER: name, PROMPT: prompt, MODEL: p.model, TEND_URL: URL_, TEND_AGENT_KEY: agent.key, TEND_AGENT_ENV_FILE: "", APPROVAL_TIMEOUT_MS: "60000",
    ...(p.real ? { [p.keyVar]: process.env[p.keyVar] } : name === "openai" ? { OPENAI_API_KEY: "offline-placeholder-key", OPENAI_BASE_URL: `${fake.url}/v1` } : { ANTHROPIC_API_KEY: "offline-placeholder-key", ANTHROPIC_BASE_URL: fake.url }) };
  const child = spawn(process.execPath, [path.join(root, "scripts/real-agents-child.mjs")], { cwd: tmpdir(), env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  const killer = setTimeout(() => child.kill("SIGKILL"), 150_000);
  const done = new Promise((r) => child.on("close", r));
  const decisions = [], seen = new Set();
  let running = true;
  const operator = (async () => {
    while (running) {
      for (const a of (await state()).authorizations.filter((x) => x.agentId === agent.id && x.status === "pending" && !seen.has(x.id))) {
        seen.add(a.id);
        const status = decide(a);
        decisions.push({ tool: a.tool, resource: a.resource, detail: a.detail, status });
        await op("POST", `/api/v1/reviews/${a.id}`, { status });
      }
      await sleep(250);
    }
  })();
  const code = await done;
  running = false;
  clearTimeout(killer);
  await operator;
  await fake?.close();
  const line = out.split("\n").find((l) => l.startsWith("RESULT "));
  const result = line ? JSON.parse(line.slice(7)) : { ok: false, error: scrub(err).split("\n").slice(-2).join(" ").slice(0, 200) || `exit ${code}` };
  if (p.real) { const c = usd(p, result.usage); spent += c; result.usd = c; }
  return { result, decisions };
}

const effect = (a, tool) => a.tools.find((t) => t.tool === tool)?.effect;
const files = () => new Set(readdirSync(sandbox));
const tryOf = (r, tool) => (r.result.calls ?? []).find((c) => c.tool === tool);
const verdictOf = (c) => (!c ? "not attempted" : c.executed ? "ran" : `NOT run (${c.outcome}${c.reason ? `: ${c.reason}` : ""})`);
const problems = [];
const check = (ok, text) => { if (!ok) problems.push(text); };

async function main() {
  say("TEND cross-provider demo: one policy, two independent agents.\n");
  await ensureBuilt();
  dataDir = mkdtempSync(path.join(tmpdir(), "tend-cross-db-"));
  sandbox = mkdtempSync(path.join(tmpdir(), "tend-cross-sb-"));
  writeFileSync(path.join(sandbox, "hello.txt"), "FICTIONAL hello file: the quarterly picnic is on Friday.\n");
  server = await startIsolatedServer({ root, env: { TEND_ADMIN_TOKEN: ADMIN, TEND_DATA_DIR: dataDir, TEND_GATEWAY_SANDBOX_DIR: sandbox } });
  URL_ = server.url;
  const login = await op("POST", "/api/operator/session", { token: ADMIN });
  if (login.status !== 200) throw new Error("Could not sign in to the throwaway TEND (a bug in the demo).");
  cookie = login.headers.get("set-cookie").split(";")[0];

  const agents = {};
  for (const [name, p] of Object.entries(PROVIDERS)) {
    const reg = await op("POST", "/api/v1/agents", { name: p.label, model: p.model, provider: p.provider });
    if (reg.status !== 201) throw new Error(`Could not register ${p.label} (${reg.status}).`);
    agents[name] = { id: reg.body.agent.id, key: reg.body.apiKey };
    secrets.push(agents[name].key);
  }
  // Policy is the operator's alone: no sign-in and an agent's own key are both refused.
  const central = (headers) => fetch(`${URL_}/api/v1/policy`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ agents: Object.values(agents).map((a) => a.id), rules: [], enforcement: "enforce" }) }).then((r) => r.status);
  check((await central({})) === 403, "central policy must refuse a caller who is not signed in as operator");
  check((await central({ authorization: `Bearer ${agents.anthropic.key}` })) === 403, "an agent must not be able to change policy");
  say(`TEND is running at ${URL_} (temporary, only on this computer). Two agents, two separate keys:`);
  for (const [name, p] of Object.entries(PROVIDERS)) say(`  ${p.label.padEnd(13)} ${p.provider} ${p.model}, ${p.real ? "REAL model" : "scripted stand-in (no API key set)"}, TEND key ${keyPrefix(agents[name].key)}`);
  const ids = Object.values(agents).map((a) => a.id);

  // ---- round 1 ---------------------------------------------------------------------------------------------------------------------
  say("\nROUND 1. One central policy, applied once to both agents: read = allow, write = ask me, delete = never.");
  const c1 = await op("POST", "/api/v1/policy", { agents: ids, rules: POLICY_V1, enforcement: "enforce" });
  check(c1.status === 200, "central policy v1 was not accepted");
  const r1 = {};
  for (const name of Object.keys(PROVIDERS)) {
    const file = `${name}-note.txt`;
    r1[name] = await runAgent(name, agents[name], promptAll(file), scriptAll(file), () => "approved");
    const r = r1[name];
    say(`  ${PROVIDERS[name].label}: read ${verdictOf(tryOf(r, "read_test_file"))}; write ${verdictOf(tryOf(r, "write_test_file"))}${r.decisions.length ? " (you approved it)" : ""}; delete ${verdictOf(tryOf(r, "delete_test_file"))}`);
    check(r.result.ok, `${name} round 1 failed: ${r.result.error}`);
    check(tryOf(r, "read_test_file")?.executed && tryOf(r, "write_test_file")?.executed && r.decisions.length === 1 && files().has(file), `${name} round 1: read and approved write should run`);
    check(tryOf(r, "delete_test_file") && !tryOf(r, "delete_test_file").executed && files().has("hello.txt"), `${name} round 1: delete must be denied`);
  }

  // ---- round 2 ---------------------------------------------------------------------------------------------------------------------
  say("\nROUND 2. The policy is changed ONCE (write: ask me -> never). Same agents, same keys, same code, nothing restarted.");
  const before = Object.fromEntries(await Promise.all(Object.entries(agents).map(async ([n, a]) => [n, (await op("GET", `/api/v1/agents/${a.id}/policy`)).body])));
  const c2 = await op("POST", "/api/v1/policy", { agents: ids, rules: POLICY_V2, enforcement: "enforce" });
  check(c2.status === 200, "central policy v2 was not accepted");
  const after = Object.fromEntries(await Promise.all(Object.entries(agents).map(async ([n, a]) => [n, (await op("GET", `/api/v1/agents/${a.id}/policy`)).body])));
  for (const n of Object.keys(PROVIDERS)) { say(`  ${PROVIDERS[n].label}: write was "${effect(before[n], "write_test_file")}", now "${effect(after[n], "write_test_file")}"`); check(effect(before[n], "write_test_file") === "approve" && effect(after[n], "write_test_file") === "deny", `${n}: the policy change did not reach this agent`); }
  const r2 = {};
  for (const name of Object.keys(PROVIDERS)) {
    const file = `${name}-note-2.txt`;
    r2[name] = await runAgent(name, agents[name], promptAll(file), scriptAll(file));
    const r = r2[name];
    say(`  ${PROVIDERS[name].label}: read ${verdictOf(tryOf(r, "read_test_file"))}; write ${verdictOf(tryOf(r, "write_test_file"))}; nobody was asked: ${r.decisions.length === 0}`);
    check(r.result.ok && tryOf(r, "read_test_file")?.executed, `${name} round 2: read should still run`);
    check(tryOf(r, "write_test_file") && !tryOf(r, "write_test_file").executed && !files().has(file) && r.decisions.length === 0, `${name} round 2: write must now be denied without asking anyone`);
  }

  // ---- audit -----------------------------------------------------------------------------------------------------------------------
  say("\nAUDIT. One history for both agents, as TEND recorded it:");
  const names = Object.fromEntries(Object.entries(agents).map(([n, a]) => [a.id, PROVIDERS[n].label]));
  const brief = (rules) => rules.map((r) => `${r.tool.replace("_test_file", "")}=${r.effect}`).join(" ");
  const line = (e) => {
    const d = e.data, who = names[e.agentId], what = `${d.tool}.${d.action}${d.resource ? ` ${d.resource}` : ""}`;
    if (e.type === "policy.updated") return `${who}: policy now v${d.version} [${brief(d.policy)}]${d.central ? ` (one central change, ${d.central} agents)` : ""}`;
    if (e.type === "review.decided") return `${who}: you ${d.status} a held request`;
    if (e.type === "key.revoked") return `${who}: key revoked`;
    if (/^authorization\./.test(e.type)) return `${who}: ${e.type.slice(14)} ${what}${d.reason ? ` (${d.reason})` : ""}`;
    return "";
  };
  const mine = (await op("GET", "/api/v1/events?since=0")).body.events.filter((e) => ids.includes(e.agentId) && line(e));
  for (const e of mine) say(`  ${new Date(e.at).toTimeString().slice(0, 8)}  ${line(e)}`);
  const per = Object.fromEntries(Object.entries(agents).map(([n, a]) => [n, mine.filter((e) => e.agentId === a.id).length]));
  say(`  (${mine.length} entries: ${Object.entries(per).map(([n, c]) => `${PROVIDERS[n].label} ${c}`).join(", ")})`);
  check(mine.filter((e) => e.type === "policy.updated").length === 4 && mine.filter((e) => e.type === "policy.updated").every((e) => e.data.central === 2), "both central policy changes should be in the history, once per agent");
  check(Object.values(per).every((c) => c > 0), "both agents should appear in the one audit history");

  // ---- revoke ----------------------------------------------------------------------------------------------------------------------
  say("\nREVOKE. The Claude agent's key is revoked. The OpenAI agent is not touched.");
  const rv = await op("DELETE", `/api/v1/agents/${agents.anthropic.id}/keys`);
  check(rv.status === 200, "revoking the Claude key failed");
  const rc = await runAgent("anthropic", agents.anthropic, PROMPT_READ, scriptRead);
  const ro = await runAgent("openai", agents.openai, PROMPT_READ, scriptRead);
  say(`  Claude agent after revocation: ${rc.result.ok ? "STILL WORKED (bad)" : `refused (${scrub(rc.result.error ?? "").split(".")[0].slice(0, 110)})`}`);
  say(`  OpenAI agent, same moment:     read ${verdictOf(tryOf(ro, "read_test_file"))}; its write is still "${effect((await op("GET", `/api/v1/agents/${agents.openai.id}/policy`)).body, "write_test_file")}"`);
  check(!rc.result.ok, "the revoked agent must be refused");
  check(ro.result.ok && tryOf(ro, "read_test_file")?.executed, "the other agent must keep working");

  say(problems.length ? `\nRESULT: something did not behave as expected:\n  - ${problems.join("\n  - ")}` : "\nRESULT: one policy controlled both agents, changing it changed both without touching their code, one audit log holds everything, and revoking one agent left the other working.");
  const real = Object.values(PROVIDERS).filter((p) => p.real).map((p) => p.provider);
  say(`Models: ${real.length ? `REAL for ${real.join(" and ")}` : "none real"}${Object.values(PROVIDERS).some((p) => !p.real) ? `; scripted stand-ins for ${Object.values(PROVIDERS).filter((p) => !p.real).map((p) => p.provider).join(" and ")} (set ${Object.values(PROVIDERS).filter((p) => !p.real).map((p) => p.keyVar).join(" / ")} for a real one)` : ""}. ${real.length ? `Approx. API cost: $${spent.toFixed(4)}. ` : ""}Took ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
  if (problems.length) process.exitCode = 1;
}

try {
  await main();
} catch (e) {
  console.error(`\n${scrub(e.message ?? e)}`);
  process.exitCode = 1;
} finally {
  await cleanup();
}
