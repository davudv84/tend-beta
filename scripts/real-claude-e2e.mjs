#!/usr/bin/env node
// REAL-MODEL end-to-end test of TEND with custom tools. A real Claude model decides on its own which of three harmless demo tools to call;
// every call goes through TEND's authorization API (the cooperative gate in examples/claude-agent/gate.mjs) before the tool body can run.
// This script plays the human operator through the same operator API the dashboard uses. Everything is fictional and local: an isolated TEND
// server (temp database, throwaway admin token), tools that only touch in-memory lists in this process, no files, no network but the Anthropic API.
//
//   ANTHROPIC_API_KEY=... npm run build && npm run e2e:real-claude [-- --report results.json]
//   npm run build && npm run e2e:real-claude -- --scripted        no API, no key: a scripted stand-in drives the same harness (checks the harness only)
//
// Scenarios, one real run each, one fresh agent each: allow, deny, approve, reject, revoke the key while a request is waiting.
// A real model cannot be forced to try an action: a scenario in which it never tried is INCONCLUSIVE, not a pass.
// Spend is measured from the API's own usage numbers (Claude Haiku 4.5 list price) and capped (MAX_USD, default 1). The key is read from the
// environment only, is never printed, and is never given to the TEND server.
import "./node-check.mjs";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { runClaude } from "../examples/claude-quickstart/agent.mjs";
import { SCENARIOS, scriptedClaude } from "../examples/claude-quickstart/scenarios.mjs";
import { connectTend } from "../examples/claude-quickstart/tend-client.mjs";
import { POLICY, createWorld } from "../examples/claude-quickstart/tools.mjs";
import { startIsolatedServer } from "./isolated-server.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const root = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const scripted = args.includes("--scripted");
const reportFile = args.includes("--report") ? args[args.indexOf("--report") + 1] : "";
const KEY = scripted ? "" : (process.env.ANTHROPIC_API_KEY ?? "");
if (!scripted && !KEY) {
  console.error(`ANTHROPIC_API_KEY is not set, so the real-model test was NOT PERFORMED.
Set it for this one command without putting it in a file or in chat, for example (zsh/bash):
  read -rs ANTHROPIC_API_KEY && export ANTHROPIC_API_KEY     # paste the key, press Enter: nothing is echoed
  npm run build && npm run e2e:real-claude
  unset ANTHROPIC_API_KEY
Never commit a key; .env* files are git-ignored here. Use --scripted to check the harness without any key.`);
  process.exit(2);
}
const MODEL = process.env.CLAUDE_MODEL ?? "claude-haiku-4-5";
const PRICE = { in: 1.0, out: 5.0 }; // USD per million tokens: Claude Haiku 4.5 list price (the cheapest current Claude model)
const BUDGET = Number(process.env.MAX_USD ?? "1");
const ADMIN = `fake_admin_${randomBytes(18).toString("hex")}`;
const secrets = [ADMIN, KEY].filter(Boolean);
const scrub = (s) => secrets.reduce((t, x) => t.split(x).join("[redacted]"), String(s));

let world = createWorld();
let client;

// ---- TEND operator API -------------------------------------------------------------------------------------------------------------
let URL_ = "", cookie = "";
async function call(method, p, { body, op, key } = {}) {
  const res = await fetch(URL_ + p, { method, headers: { ...(body !== undefined && { "content-type": "application/json" }), ...(op && { cookie }), ...(key && { authorization: `Bearer ${key}` }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}
const state = async () => (await call("GET", "/api/v1/state", { op: true })).body.projection;

// ---- one scenario ------------------------------------------------------------------------------------------------------------------
const cost = (u) => (u.in * PRICE.in + u.out * PRICE.out) / 1e6;
let total = { in: 0, out: 0, calls: 0 };
async function scenario(s) {
  world = createWorld();
  const reg = await call("POST", "/api/v1/agents", { op: true, body: { name: `Claude e2e: ${s.id}`, model: MODEL, provider: "Anthropic" } });
  if (reg.status !== 201) throw new Error(`register failed: ${reg.status}`);
  const agent = { id: reg.body.agent.id, key: reg.body.apiKey };
  secrets.push(agent.key);
  const pol = await call("POST", `/api/v1/agents/${agent.id}/policy`, { op: true, body: { rules: POLICY, enforcement: "enforce" } });
  if (pol.status !== 200) throw new Error(`policy failed: ${pol.status}`);

  const r = { id: s.id, usage: { in: 0, out: 0, calls: 0 }, attempts: [], outcomes: [], pending: [], decisions: [], apiErrors: [], final: "", stop: [] };
  const onPending = async (authId) => {
    const a = (await state()).authorizations.find((x) => x.id === authId);
    r.pending.push({ id: authId, status: a?.status, tool: a?.tool, resource: a?.resource, detail: a?.detail, runsAtPending: { ...world.runs }, outboxAtPending: world.outbox.length });
    if (s.decision === "approve" || s.decision === "reject") r.decisions.push({ id: authId, status: s.decision === "approve" ? "approved" : "rejected", http: (await call("POST", `/api/v1/reviews/${authId}`, { op: true, body: { status: s.decision === "approve" ? "approved" : "rejected" } })).status });
    if (s.decision === "revoke") r.decisions.push({ id: authId, status: "key revoked", http: (await call("DELETE", `/api/v1/agents/${agent.id}/keys`, { op: true })).status });
  };
  const gate = connectTend({ url: URL_, key: agent.key, pollMs: 400, approvalTimeoutMs: 60_000, onPending });
  const run = await runClaude({ client, gate, world, prompt: s.prompt, model: MODEL, shouldStop: () => cost(total) >= BUDGET, onUsage: (u) => { for (const t of [r.usage, total]) { t.in += u.input_tokens; t.out += u.output_tokens; t.calls++; } } });
  Object.assign(r, { attempts: run.attempts, outcomes: run.outcomes, final: run.final.slice(0, 300), stop: run.stops, apiErrors: run.errors });

  // ---- what TEND recorded, read back through the operator API -----------------------------------------------------------------------
  const st = await state();
  const auths = st.authorizations.filter((a) => a.agentId === agent.id);
  const logs = st.log.filter((l) => l.agentId === agent.id);
  const logTypes = {};
  for (const l of logs) logTypes[l.type] = (logTypes[l.type] ?? 0) + 1;
  const keyAfter = (await call("GET", "/api/v1/agent/inbox", { key: agent.key })).status;
  return { r, auths, logTypes, keyAfter, world: { runs: { ...world.runs }, outbox: [...world.outbox], recordsLeft: Object.keys(world.records) } };
}

function judge(s, x) {
  const checks = [], add = (ok, text) => checks.push({ ok: !!ok, text });
  const tried = x.r.attempts.filter((a) => a.tool === s.expect.tool);
  if (x.r.apiErrors.length) return { verdict: "ERROR", checks, why: x.r.apiErrors[0] };
  if (!tried.length) return { verdict: "INCONCLUSIVE", checks, why: `the model never tried ${s.expect.tool}` };
  const a = x.auths.filter((q) => q.tool === s.expect.tool), run = x.world.runs[s.expect.tool];
  add(a.length >= 1, `TEND recorded an authorization for ${s.expect.tool}`);
  add(run === s.expect.runs, `the tool body ran ${run} time(s), expected ${s.expect.runs}`);
  if (s.id === "allow") {
    add(a.every((q) => q.status === "consumed" && q.reason === "policy_allowed"), "audit: authorization allowed by policy and consumed");
    add(x.r.pending.length === 0, "no human was needed");
    add(x.logTypes.authorization_requested === 1 && x.logTypes.authorization_consumed === 1 && !x.logTypes.authorization_approved && !x.logTypes.authorization_rejected, "audit log: requested then consumed, no human decision");
  }
  if (s.id === "deny") {
    add(a.every((q) => q.status === "denied" && q.reason === "policy_denied") && x.logTypes.authorization_denied === 1 && !x.logTypes.authorization_consumed, "audit: denied by policy, recorded once, never consumed");
    add(x.r.pending.length === 0, "the denial never reached a person");
    add(x.world.recordsLeft.includes("R-7"), "the record still exists");
  }
  if (s.id === "approve") {
    const p = x.r.pending[0], consumed = a.filter((q) => q.status === "consumed");
    add(x.r.pending.length === 1 && p?.status === "pending", "TEND held the request as pending before anything ran");
    add(p && p.runsAtPending.send_demo_email === 0 && p.outboxAtPending === 0, "at the moment it was pending, the tool had not run");
    add(consumed.length === 1, "audit: exactly one authorization consumed");
    add(x.logTypes.authorization_requested === 1 && x.logTypes.authorization_approved === 1 && x.logTypes.authorization_consumed === 1, "audit log: requested, approved by a person, consumed: once each");
    add(x.world.outbox.length === 1 && p && p.detail === `To ${x.world.outbox[0].to}; subject: ${x.world.outbox[0].subject}; body: ${x.world.outbox[0].body}`, "what ran is exactly what the person was shown and approved");
  }
  if (s.id === "reject") {
    const p = x.r.pending[0];
    add(x.r.pending.length >= 1 && p?.status === "pending", "TEND held the request as pending before anything ran");
    add(a.every((q) => q.status === "rejected"), "audit: authorization rejected");
    add(x.logTypes.authorization_rejected >= 1 && !x.logTypes.authorization_approved && !x.logTypes.authorization_consumed, "audit log: the human rejection is recorded; no approval, no consumption");
    add(x.world.outbox.length === 0, "nothing was sent");
  }
  if (s.id === "revoke") {
    add(x.r.pending.length >= 1 && x.r.decisions[0]?.http === 200, "TEND held the request, then the key was revoked while it waited");
    add(a.every((q) => q.status === "cancelled") && x.logTypes.key_revoked === 1 && x.logTypes.authorization_cancelled >= 1 && !x.logTypes.authorization_consumed, "audit log: key revoked, the waiting authorization cancelled, never consumed");
    add(x.keyAfter === 401, "the revoked key is refused");
    add(x.world.outbox.length === 0, "nothing was sent");
  }
  const outcomeOk = x.r.outcomes.filter((o) => o.tool === s.expect.tool).every((o) => (s.expect.runs ? o.executed : !o.executed));
  add(outcomeOk, "the agent was told the truth (executed only when TEND allowed it)");
  return { verdict: checks.every((c) => c.ok) ? "PASS" : "FAIL", checks };
}

async function main() {
  const dataDir = mkdtempSync(path.join(tmpdir(), "tend-claude-e2e-db-"));
  // The agent side holds the provider key; the TEND server never gets it (isolated-server builds the server's environment from scratch).
  const server = await startIsolatedServer({ root, env: { TEND_ADMIN_TOKEN: ADMIN, TEND_DATA_DIR: dataDir, TEND_GATEWAY_SANDBOX_DIR: dataDir } });
  URL_ = server.url;
  try {
    const login = await call("POST", "/api/operator/session", { body: { token: ADMIN } });
    if (login.status !== 200) throw new Error("operator sign-in failed");
    cookie = login.headers.get("set-cookie").split(";")[0];
    if (scripted) client = scriptedClaude();
    else { const { default: Anthropic } = await import("@anthropic-ai/sdk"); client = new Anthropic({ apiKey: KEY, maxRetries: 1 }); }
    console.log(`isolated TEND on ${URL_}; model: ${scripted ? "SCRIPTED STAND-IN (no API)" : `${MODEL} (real, Anthropic API)`}; budget cap $${BUDGET}`);
    const out = [];
    for (const s of SCENARIOS) {
      process.stdout.write(`scenario ${s.id} ... `);
      const x = await scenario(s);
      const j = judge(s, x);
      console.log(`${j.verdict}${j.why ? ` (${j.why})` : ""}  calls=${x.r.usage.calls} tokens=${x.r.usage.in}+${x.r.usage.out} $${cost(x.r.usage).toFixed(5)}`);
      out.push({ scenario: s.id, ...j, usage: x.r.usage, usd: cost(x.r.usage), model_tool_attempts: x.r.attempts, outcomes: x.r.outcomes, pending: x.r.pending, decisions: x.r.decisions, authorizations: x.auths.map((a) => ({ tool: a.tool, resource: a.resource, status: a.status, reason: a.reason })), audit_log_types: x.logTypes, tool_runs: x.world.runs, outbox: x.world.outbox, final_answer: x.r.final, stop_reasons: x.r.stop, api_errors: x.r.apiErrors });
    }
    console.log("\n--- results ---");
    for (const o of out) { console.log(`${o.verdict.padEnd(12)} ${o.scenario}`); for (const c of o.checks ?? []) console.log(`    ${c.ok ? "ok  " : "FAIL"} ${c.text}`); if (o.final_answer) console.log(`    model said: ${scrub(o.final_answer).replace(/\s+/g, " ")}`); }
    const usd = cost(total);
    console.log(`\nAPI usage: ${total.calls} calls, ${total.in} input + ${total.out} output tokens, $${usd.toFixed(5)} (list price ${MODEL}, $${PRICE.in}/$${PRICE.out} per million)`);
    const counts = out.reduce((m, o) => ((m[o.verdict] = (m[o.verdict] ?? 0) + 1), m), {});
    console.log(`verdicts: ${JSON.stringify(counts)}  (${scripted ? "scripted stand-in: harness check only, NOT a real-model result" : "real model"})`);
    if (reportFile) writeFileSync(reportFile, scrub(JSON.stringify({ model: scripted ? "scripted" : MODEL, real: !scripted, usage: total, usd, results: out }, null, 2)));
    process.exitCode = out.every((o) => o.verdict === "PASS") ? 0 : 1;
  } finally {
    await server.stop();
    rmSync(dataDir, { recursive: true, force: true });
  }
}
main().catch((e) => { console.error(scrub(e.stack ?? e)); process.exit(1); });
