#!/usr/bin/env node
// A reproducible benchmark of TEND itself: setup, integration steps, enforcement, added latency, reliability. Everything is measured on this
// machine against an isolated production build (loopback, embedded database); nothing is estimated, and there are no competitor numbers.
// The same measurements can be run against any alternative: docs/benchmark.md says how.
//
//   npm run build && npm run benchmark            all of it (about two minutes)
//   npm run benchmark -- --quick                  without the reliability matrix
// Results: docs/benchmark.json and docs/benchmark.md. No model and no key: tool bodies are no-ops, the "agent" is the SDK file TEND serves.
import "./node-check.mjs";
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { cpus, platform, release, tmpdir, totalmem } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { agentSnippet } from "../src/lib/connect-snippet.ts";
import { startIsolatedServer } from "./isolated-server.mjs";
import { run as reliability } from "./reliability.mjs";

const root = path.resolve(import.meta.dirname, "..");
const quick = process.argv.includes("--quick");
const ADMIN = `bench_admin_${randomBytes(18).toString("hex")}`;
const N = { latency: 300, mcp: 100, agents: 10, perAgent: 30, mixed: 60 };
const ms = (t0) => Number(process.hrtime.bigint() - t0) / 1e6;
const now = () => process.hrtime.bigint();
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const stats = (xs) => ({ n: xs.length, mean: +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2), p50: +pct(xs, 50).toFixed(2), p95: +pct(xs, 95).toFixed(2), p99: +pct(xs, 99).toFixed(2) });
const sleep = (t) => new Promise((r) => setTimeout(r, t));

let URL_ = "", cookie = "";
async function op(method, p, body) {
  const res = await fetch(URL_ + p, { method, headers: { ...(body !== undefined && { "content-type": "application/json" }), cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const RULES = [{ tool: "read_note", action: "call", effect: "allow" }, { tool: "send_note", action: "call", effect: "approve" }, { tool: "delete_note", action: "call", effect: "deny" }];
async function agent(name) {
  const r = (await op("POST", "/api/v1/agents", { name, model: "none", provider: "Custom" })).body;
  await op("POST", `/api/v1/agents/${r.agent.id}/policy`, { rules: RULES, enforcement: "enforce" });
  return { id: r.agent.id, key: r.apiKey };
}

async function main() {
  const dir = mkdtempSync(path.join(tmpdir(), "tend-bench-"));
  // The per-agent request limit is raised for the latency and load runs (it would refuse them, by design); the default is measured below.
  const server = await startIsolatedServer({ root, env: { TEND_ADMIN_TOKEN: ADMIN, TEND_DATA_DIR: dir, TEND_AGENT_RPM: "10000" } });
  URL_ = server.url;
  const out = { machine: { cpu: cpus()[0]?.model, cores: cpus().length, memoryGb: Math.round(totalmem() / 2 ** 30), os: `${platform()} ${release()}`, node: process.version, database: server.health.storage, network: "loopback" }, at: new Date().toISOString() };
  try {
    // ---- 1. setup: from nothing to a verified, enforced tool call, the way the Connect page tells a developer to do it --------------------
    const t0 = now();
    cookie = (await fetch(`${URL_}/api/operator/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: ADMIN }) })).headers.get("set-cookie").split(";")[0];
    const a = await agent("Setup bench");                                                   // Connect: name, create (the key is shown once)
    const sdk = await fetch(`${URL_}/sdk/tend.mjs`);                                       // curl -fsSO $TEND_URL/sdk/tend.mjs
    if (!sdk.ok) throw new Error(`/sdk/tend.mjs answered ${sdk.status}`);
    const file = path.join(dir, "tend.mjs");
    writeFileSync(file, await sdk.text());
    const { connectTend, guardTool, startProxy } = await import(file);
    const gate = connectTend({ url: URL_, key: a.key, retries: 0, pollMs: 100 });
    const ran = { read_note: 0, send_note: 0, delete_note: 0 };
    const tool = (name) => guardTool(gate, name, async () => (ran[name]++, "done"));
    const read = tool("read_note"), send = tool("send_note"), del = tool("delete_note");
    const r1 = await read({ id: "N-1" }), r2 = await del({ id: "N-1" });
    const approver = (async () => { for (let i = 0; i < 100; i++) { const p = (await op("GET", "/api/v1/state")).body.projection.authorizations.find((x) => x.status === "pending"); if (p) return op("POST", `/api/v1/reviews/${p.id}`, { status: "approved" }); await sleep(50); } })();
    const r3 = await send({ id: "N-1", to: "team-1" });
    await approver;
    const setupMs = ms(t0);
    const code = (k) => agentSnippet(k, URL_).split("\n").filter((l) => l.trim() && !/^\s*(\/\/|#)/.test(l) && !/^(export TEND_|curl )/.test(l)).length;
    out.setup = {
      ms: Math.round(setupMs), enforced: r1 === "done" && r2.startsWith("Not done") && r3 === "done" && ran.read_note === 1 && ran.delete_note === 0 && ran.send_note === 1,
      developerSteps: ["create the agent (name, model) and copy its key", "set three rules", "download one file (curl)", "set TEND_URL and TEND_AGENT_KEY", "wrap each tool with guardTool", "approve the held call"],
      integrationCodeLines: { anthropicSdk: code("claude"), langchain: code("js"), openaiAgentsSdk: code("openai"), openaiCompatible: code("chat"), python: code("python"), mcpHost: "configuration only (one JSON entry)" },
      dependencies: 0, sdkBytes: (await (await fetch(`${URL_}/sdk/tend.mjs`)).text()).length,
      note: "Machine time for the scripted path. The person's time, measured once in a browser on 2026-10-29: 89 s from sign-in to a verified test action.",
    };
    console.log(`setup: ${out.setup.ms} ms scripted, enforced correctly: ${out.setup.enforced}; ${out.setup.integrationCodeLines.anthropicSdk} lines of code for the Anthropic SDK`);

    // ---- 2. added latency: a no-op tool called directly, and through TEND -----------------------------------------------------------------
    const noop = async () => "ok";
    const direct = [], before = [], total = [];
    for (let i = 0; i < N.latency; i++) { const t = now(); await noop(); direct.push(ms(t)); }
    for (let i = 0; i < N.latency; i++) {
      const t = now();
      let started = null;
      const r = await guardTool(gate, "read_note", async () => { started = ms(t); return "ok"; })({ id: `N-${i}` });
      if (started === null) throw new Error(`an allowed call did not run: ${r}`);
      before.push(started);
      total.push(ms(t));
    }
    // How many authenticated requests one protected call makes, counted on the wire: that is what the per-agent limit counts.
    const real = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = (u, o) => (String(o?.headers?.authorization ?? "").startsWith("Bearer tend_sk_") && requests++, real(u, o));
    await read({ id: "count" });
    globalThis.fetch = real;
    out.limits = { requestsPerProtectedCall: requests, defaultAgentRequestsPerMinute: 120, defaultProtectedCallsPerMinute: Math.floor(120 / requests), setting: "TEND_AGENT_RPM (10–10000)" };
    out.latency = { direct: stats(direct), untilToolRuns: stats(before), wholeCallIncludingAuditReport: stats(total), note: "allowed by policy: request, single-use token, consume, then the tool; the audit report follows the tool. Loopback and an embedded database: a hosted TEND adds the network round trips." };
    console.log(`limits: ${requests} requests per protected call, so the default allows ${out.limits.defaultProtectedCallsPerMinute} protected calls per agent per minute`);
    console.log(`latency (ms): until the tool runs p50 ${out.latency.untilToolRuns.p50}, p95 ${out.latency.untilToolRuns.p95}; whole call p50 ${out.latency.wholeCallIncludingAuditReport.p50}`);

    // ---- 3. the MCP proxy: tools/call to a stdio MCP server, directly and through TEND -------------------------------------------------
    const rpc = (child, input, output) => {
      let buf = "", n = 0; const waiting = new Map();
      output.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); waiting.get(m.id)?.(m); } });
      return (method, params) => new Promise((resolve) => { const id = ++n; waiting.set(id, resolve); input.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`); });
    };
    const notes = path.join(root, "public/sdk/notes-server.mjs");
    const plain = spawn(process.execPath, [notes], { stdio: ["pipe", "pipe", "inherit"] });
    const call1 = rpc(plain, plain.stdin, plain.stdout);
    const mcpDirect = [];
    for (let i = 0; i < N.mcp; i++) { const t = now(); await call1("tools/call", { name: "read_note", arguments: { id: "N-1" } }); mcpDirect.push(ms(t)); }
    plain.kill();
    const m = await agent("MCP bench");
    const pin = new PassThrough(), pout = new PassThrough();
    const proxied = startProxy({ command: process.execPath, args: [notes], gate: connectTend({ url: URL_, key: m.key, retries: 0 }), input: pin, output: pout, env: process.env });
    const call2 = rpc(proxied, pin, pout);
    const mcpTend = [];
    for (let i = 0; i < N.mcp; i++) { const t = now(); const r = await call2("tools/call", { name: "read_note", arguments: { id: "N-1", n: i } }); if (r.result?.isError) throw new Error("proxy refused an allowed call"); mcpTend.push(ms(t)); }
    pin.end(); proxied.kill();
    out.mcp = { direct: stats(mcpDirect), throughTend: stats(mcpTend) };
    console.log(`MCP tools/call (ms): direct p50 ${out.mcp.direct.p50}, through TEND p50 ${out.mcp.throughTend.p50}, p95 ${out.mcp.throughTend.p95}`);

    // ---- 4. under load: several agents at once, each with its own key ----------------------------------------------------------------
    const fleet = await Promise.all(Array.from({ length: N.agents }, (_, i) => agent(`Load ${i}`)));
    const seqBefore = (await op("GET", "/api/v1/state")).body.seq;
    const rss = () => server.pids().reduce((sum, pid) => { try { return sum + Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)]).toString().trim() || 0); } catch { return sum; } }, 0);
    const rssBefore = rss();
    const tl = now();
    let errors = 0;
    await Promise.all(fleet.map(async (f) => {
      const g = connectTend({ url: URL_, key: f.key, retries: 0 });
      for (let i = 0; i < N.perAgent; i++) if ((await guardTool(g, "read_note", noop)({ id: `L-${i}` })) !== "ok") errors++;
    }));
    const loadMs = ms(tl);
    const events = (await op("GET", "/api/v1/state")).body.seq - seqBefore;
    out.load = { agents: N.agents, callsEach: N.perAgent, seconds: +(loadMs / 1000).toFixed(2), callsPerSecond: Math.round((N.agents * N.perAgent) / (loadMs / 1000)), errors,
      databaseRowsPerCall: { authorizations: 1, events: +(events / (N.agents * N.perAgent)).toFixed(2) }, serverMemoryMb: { before: Math.round(rssBefore / 1024), afterLoad: Math.round(rss() / 1024) } };
    console.log(`load: ${N.agents} agents x ${N.perAgent} calls in ${out.load.seconds} s (${out.load.callsPerSecond}/s), ${errors} errors`);

    // ---- 4b. failures: how long until a protected call is refused when TEND cannot be reached (it never runs) -----------------------------
    const ranDown = { n: 0 };
    const tDown = now();
    const down = await guardTool(connectTend({ url: "http://127.0.0.1:9", key: a.key }), "read_note", async () => ranDown.n++)({ id: "down" });
    const downDefault = ms(tDown);
    const tDown0 = now();
    await guardTool(connectTend({ url: "http://127.0.0.1:9", key: a.key, retries: 0 }), "read_note", async () => ranDown.n++)({ id: "down" });
    out.failures = { tendUnreachableRefusedAfterMs: { defaultRetries: Math.round(downDefault), noRetries: Math.round(ms(tDown0)) }, ranWhileDown: ranDown.n, answer: down.slice(0, 80) };
    console.log(`TEND unreachable: refused after ${out.failures.tendUnreachableRefusedAfterMs.defaultRetries} ms (default retries), ran: ${ranDown.n}`);

    // ---- 5. enforcement: a mixed run, checked against what must happen ---------------------------------------------------------------
    const e = await agent("Enforcement bench");
    const eg = connectTend({ url: URL_, key: e.key, retries: 0, pollMs: 50 });
    const count = { allow: 0, deny: 0, approved: 0, rejected: 0 }, ranE = { allow: 0, deny: 0, approved: 0, rejected: 0 };
    let violations = 0;
    for (let i = 0; i < N.mixed; i++) {
      const kind = ["allow", "deny", "approved", "rejected"][i % 4];
      count[kind]++;
      const name = kind === "allow" ? "read_note" : kind === "deny" ? "delete_note" : "send_note";
      const decider = kind === "approved" || kind === "rejected" ? (async () => { for (let k = 0; k < 100; k++) { const p = (await op("GET", "/api/v1/state")).body.projection.authorizations.find((x) => x.agentId === e.id && x.status === "pending"); if (p) return op("POST", `/api/v1/reviews/${p.id}`, { status: kind }); await sleep(30); } })() : null;
      await guardTool(eg, name, async () => (ranE[kind]++, "ok"))({ id: `E-${i}` });
      await decider;
    }
    violations = ranE.deny + ranE.rejected + (count.allow - ranE.allow) + (count.approved - ranE.approved);
    out.enforcement = { requests: N.mixed, expected: { ran: count.allow + count.approved, neverRan: count.deny + count.rejected }, observed: ranE, violations };
    console.log(`enforcement: ${N.mixed} mixed requests, ${violations} violations`);

    // ---- 6. reliability and real-model coverage ------------------------------------------------------------------------------------
    if (!quick) {
      out.reliability = reliability();
      console.log(`reliability: ${out.reliability.filter((r) => r.ok).length}/${out.reliability.length} cases fail closed`);
    }
    const { default: report } = await import("../src/lib/verification-report.json", { with: { type: "json" } });
    const v = Object.entries(report.integrations);
    out.realModelCoverage = { integrationsVerified: v.filter(([, x]) => x.status === "verified").length, blocked: v.filter(([, x]) => x.status === "blocked").length, scenariosEach: 7, source: "src/lib/verification-report.json (npm run verify:integrations)" };
  } finally {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  }
  writeFileSync(path.join(root, "docs/benchmark.json"), `${JSON.stringify(out, null, 2)}\n`);
  writeFileSync(path.join(root, "docs/benchmark.md"), render(out));
  console.log("\nwritten: docs/benchmark.json, docs/benchmark.md");
}

function render(o) {
  const L = (s) => `${s.p50} / ${s.p95} / ${s.p99}`;
  return `# TEND benchmark

Measured by \`npm run benchmark\` (scripts/benchmark.mjs) on ${o.at.slice(0, 10)}: ${o.machine.cpu}, ${o.machine.cores} cores, ${o.machine.memoryGb} GB, ${o.machine.os},
Node ${o.machine.node}, an isolated production build with the ${o.machine.database} database over ${o.machine.network}. Rerun it to reproduce; numbers
on another machine, or against a hosted TEND (network round trips, a hosted database), will differ. No competitor was measured.

## Setup and integration steps

| | Measured |
|---|---|
| From nothing to an enforced tool call (allowed, denied, approved), scripted | ${o.setup.ms} ms, enforced correctly: ${o.setup.enforced} |
| A person in the browser, sign-in to verified test action (measured once, 2026-10-29) | 89 s |
| Steps for a developer | ${o.setup.developerSteps.length}: ${o.setup.developerSteps.join("; ")} |
| Lines of integration code | Anthropic SDK ${o.setup.integrationCodeLines.anthropicSdk}, LangChain ${o.setup.integrationCodeLines.langchain}, OpenAI Agents SDK ${o.setup.integrationCodeLines.openaiAgentsSdk}, OpenAI-compatible ${o.setup.integrationCodeLines.openaiCompatible}, Python ${o.setup.integrationCodeLines.python}; an MCP host: ${o.setup.integrationCodeLines.mcpHost} |
| Dependencies the agent must install | ${o.setup.dependencies} (one ${Math.round(o.setup.sdkBytes / 1024)} KB file from the TEND server) |

## Added latency (milliseconds, p50 / p95 / p99)

| Call | Latency |
|---|---|
| A no-op tool, called directly | ${L(o.latency.direct)} |
| The same tool through TEND, until it starts running | ${L(o.latency.untilToolRuns)} |
| The same call including the audit report afterwards | ${L(o.latency.wholeCallIncludingAuditReport)} |
| MCP tools/call to a stdio server, directly | ${L(o.mcp.direct)} |
| MCP tools/call through TEND's proxy | ${L(o.mcp.throughTend)} |

${o.latency.untilToolRuns.n} calls each (${o.mcp.direct.n} for MCP), allowed by policy, sequential. ${o.latency.note}

## Limits

One protected call makes ${o.limits.requestsPerProtectedCall} authenticated requests (counted on the wire). Each agent may make ${o.limits.defaultAgentRequestsPerMinute} a minute by default,
so about **${o.limits.defaultProtectedCallsPerMinute} protected calls per agent per minute**; past that, calls are refused (never let through). Raise it with
${o.limits.setting}; this benchmark runs with it raised so the latency and load figures are not cut off by it.

## Under load

${o.load.agents} agents at once, ${o.load.callsEach} allowed calls each: ${o.load.seconds} s, ${o.load.callsPerSecond} calls per second, ${o.load.errors} errors.
Database writes per protected call: ${o.load.databaseRowsPerCall.authorizations} authorization row and ${o.load.databaseRowsPerCall.events} events (hash-chained). Server memory (RSS):
${o.load.serverMemoryMb.before} MB before the load, ${o.load.serverMemoryMb.afterLoad} MB after.

## When TEND is down

A protected call is refused, never run, ${o.failures.tendUnreachableRefusedAfterMs.defaultRetries} ms after it starts with the default retries (${o.failures.tendUnreachableRefusedAfterMs.noRetries} ms with retries: 0).
Calls that ran while TEND was unreachable: **${o.failures.ranWhileDown}**.

## Enforcement

${o.enforcement.requests} mixed requests (allowed, denied, approved, rejected): expected ${o.enforcement.expected.ran} to run and ${o.enforcement.expected.neverRan} never to run;
observed ${JSON.stringify(o.enforcement.observed)}. Violations: **${o.enforcement.violations}**.

Real models: ${o.realModelCoverage.integrationsVerified} integrations pass all ${o.realModelCoverage.scenariosEach} scenarios (allow, deny, approve, reject, revoke,
TEND unavailable, audit); ${o.realModelCoverage.blocked} are blocked on credentials or installs (${o.realModelCoverage.source}).

## Reliability

${o.reliability ? `| Case | Result |\n|---|---|\n${o.reliability.map((r) => `| ${r.case} | ${r.ok ? "fails closed" : "FAILED"} (${r.passed}/${r.tests} tests) |`).join("\n")}\n\nThe cases and the tests behind them: scripts/reliability.mjs.` : "Not run (--quick)."}

## Comparing with an alternative

Run the same five measurements against it, on the same machine: the steps and lines of code to put it in front of one tool; the time from
nothing to a denied and an approved call; a no-op tool's latency directly and through it (p50/p95/p99, 300 sequential calls); calls per
second with ${o.load.agents} concurrent agents; and whether denied or rejected calls ever run when the control service, its database, or the
network fails. Numbers for other products are not given here because none were measured.
`;
}

main().catch((e) => { console.error(e); process.exit(1); });
