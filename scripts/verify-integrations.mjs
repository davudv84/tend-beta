#!/usr/bin/env node
// The integration verification suite: the same real scenarios for every integration in the Integrations directory, judged only from what
// TEND recorded and from a ledger of what really ran. No mocked provider counts: a driver either connects to the real model, framework or
// host, or the integration is reported BLOCKED with what is missing.
//
//   npm run build && npm run verify:integrations                     every integration whose requirements are met
//   npm run verify:integrations -- --only claude,mcp                 just these
//   npm run verify:integrations -- --list                            what each driver needs, and whether it is there
//
// Scenarios, one fresh agent each, all tools harmless (fictional in-memory notes, see examples/mcp-proxy/notes-server.mjs):
//   allow        read_note is allowed by policy: it runs once, and TEND logs it
//   deny         delete_note is denied by policy: it never runs
//   approve      send_note needs a person: held, nothing runs, approved, then it runs exactly once
//   reject       the same, rejected: it never runs
//   revoke       the same, the agent's key revoked while it waits: it never runs, and the key is refused afterwards
//   unavailable  TEND is not reachable: the call is refused (fail closed) and nothing runs
//   audit        every decision above is in TEND's audit log
// A real model cannot be forced to try a tool: if it never tried, the scenario is INCONCLUSIVE, which is not a pass.
// Results go to src/lib/verification-report.json (read by the Integrations page) and docs/verification-report.md. Keys come from the
// environment (ANTHROPIC_API_KEY, ...), are never printed or written, and are never given to the TEND server.
import "./node-check.mjs";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DRIVERS } from "./verify/drivers.mjs";
import { POLICY, SCENARIOS, SYSTEM, judge, summarize } from "./verify/judge.mjs";
import { startIsolatedServer } from "./isolated-server.mjs";

const root = path.resolve(import.meta.dirname, "..");
const REPORT = path.join(root, "src/lib/verification-report.json");
const DOC = path.join(root, "docs/verification-report.md");
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
const BUDGET = Number(process.env.MAX_USD ?? "4.5");
const ADMIN = `verify_admin_${randomBytes(18).toString("hex")}`;
const secrets = [ADMIN, ...["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "MISTRAL_API_KEY", "GROQ_API_KEY"].map((k) => process.env[k]).filter(Boolean)];
const scrub = (s) => secrets.reduce((t, x) => t.split(x).join("[redacted]"), String(s));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- TEND operator API ------------------------------------------------------------------------------------------------------------
let URL_ = "", cookie = "";
async function call(method, p, { body, op, key } = {}) {
  const res = await fetch(URL_ + p, { method, headers: { ...(body !== undefined && { "content-type": "application/json" }), ...(op && { cookie }), ...(key && { authorization: `Bearer ${key}` }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}
const state = async () => (await call("GET", "/api/v1/state", { op: true })).body.projection;
const readLedger = (f) => (existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const count = (lines, ev, tool) => lines.filter((l) => l.ev === ev && l.tool === tool).length;

async function scenario(driver, s, dir) {
  const ledger = path.join(dir, `${driver.id}-${s.id}.jsonl`);
  let agent = { id: null, key: `tend_sk_${randomBytes(16).toString("hex")}` }; // unavailable: a key TEND never issued, for a TEND that is not there
  if (!s.tendDown) {
    const reg = await call("POST", "/api/v1/agents", { op: true, body: { name: `verify ${driver.id} ${s.id}`, model: driver.model ?? "n/a", provider: driver.provider } });
    if (reg.status !== 201) throw new Error(`register failed: ${reg.status}`);
    agent = { id: reg.body.agent.id, key: reg.body.apiKey };
    if ((await call("POST", `/api/v1/agents/${agent.id}/policy`, { op: true, body: { rules: POLICY, enforcement: "enforce" } })).status !== 200) throw new Error("policy failed");
  }
  secrets.push(agent.key);

  // Play the person: the first time TEND holds a request of this agent, note what had run by then, then decide.
  const seen = { pending: null, decision: null };
  let watching = !s.tendDown;
  const watcher = (async () => {
    while (watching) {
      const a = (await state()).authorizations.find((x) => x.agentId === agent.id && x.status === "pending");
      if (a && !seen.pending) {
        seen.pending = { id: a.id, tool: a.tool, detail: a.detail, ranBefore: count(readLedger(ledger), "ran", a.tool) };
        if (s.decision === "revoke") seen.decision = (await call("DELETE", `/api/v1/agents/${agent.id}/keys`, { op: true })).status;
        else if (s.decision) seen.decision = (await call("POST", `/api/v1/reviews/${a.id}`, { op: true, body: { status: s.decision } })).status;
      }
      await sleep(250);
    }
  })();
  const started = Date.now();
  let out;
  try {
    out = await Promise.race([
      driver.run({ url: s.tendDown ? "http://127.0.0.1:9" : URL_, key: agent.key, prompt: s.prompt, system: SYSTEM, ledger, dir }),
      sleep(240_000).then(() => ({ error: "timed out after 240s" })),
    ]);
  } catch (e) {
    out = { error: scrub(e.message ?? e).slice(0, 200) };
  }
  watching = false;
  await watcher;
  const lines = readLedger(ledger);
  const st = await state();
  const auths = agent.id ? st.authorizations.filter((a) => a.agentId === agent.id) : [];
  const logTypes = {};
  for (const l of agent.id ? st.log.filter((x) => x.agentId === agent.id) : []) logTypes[l.type] = (logTypes[l.type] ?? 0) + 1;
  // The agent's own report of what ran (tool.called), and any alert TEND raised because a report did not match what it had authorized.
  const reports = agent.id ? (st.taskEvents ?? []).filter((e) => e.agentId === agent.id && e.type === "tool.called") : [];
  const ALERTS = ["unauthorized_execution", "unapproved_execution", "authorization_mismatch", "authorization_replay"];
  const alerts = [...auths.filter((q) => q.alerts > 0).map((q) => q.id), ...ALERTS.filter((t) => logTypes[t])];
  const keyAfter = agent.id ? (await call("GET", "/api/v1/agent/inbox", { key: agent.key })).status : null;
  const attempts = out.attempts ?? lines.filter((l) => l.ev === "attempt").map((l) => l.tool);
  return { out, seen, auths, logTypes, reports, alerts, keyAfter, attempts, ran: count(lines, "ran", s.tool), seconds: Math.round((Date.now() - started) / 1000) };
}

async function main() {
  const drivers = DRIVERS.filter((d) => !only || only.includes(d.id));
  if (args.includes("--list")) {
    for (const d of DRIVERS) { const m = d.sameAs ? [] : await d.requires(); console.log(`${d.id.padEnd(17)} ${d.sameAs ? `uses the ${d.sameAs} run` : m.length ? `BLOCKED: ${m.join("; ")}` : "ready"}  (${d.label})`); }
    return;
  }
  const previous = existsSync(REPORT) ? JSON.parse(readFileSync(REPORT, "utf8")) : { integrations: {} };
  const report = { suite: "npm run verify:integrations", generatedAt: new Date().toISOString(), integrations: { ...previous.integrations } };
  const dir = mkdtempSync(path.join(tmpdir(), "tend-verify-"));
  const server = await startIsolatedServer({ root, env: { TEND_ADMIN_TOKEN: ADMIN, TEND_DATA_DIR: dir, TEND_GATEWAY_SANDBOX_DIR: dir } });
  URL_ = server.url;
  let spent = 0;
  try {
    const login = await call("POST", "/api/operator/session", { body: { token: ADMIN } });
    if (login.status !== 200) throw new Error("operator sign-in failed");
    cookie = login.headers.get("set-cookie").split(";")[0];
    console.log(`isolated TEND on ${URL_}; budget cap $${BUDGET}`);
    for (const d of drivers.filter((x) => !x.sameAs)) {
      const now = new Date().toISOString();
      const missing = await d.requires();
      if (missing.length) {
        console.log(`\n${d.id}: BLOCKED (${missing.join("; ")})`);
        report.integrations[d.id] = { ...report.integrations[d.id], status: report.integrations[d.id]?.status === "verified" ? "verified" : "blocked", label: d.label, missing, lastCheckedAt: now };
        continue;
      }
      if (spent >= BUDGET) { console.log(`\n${d.id}: NOT RUN (budget of $${BUDGET} reached)`); continue; }
      console.log(`\n${d.id}: ${d.label}`);
      const results = [];
      let usd = 0;
      for (const s of SCENARIOS) {
        process.stdout.write(`  ${s.id.padEnd(12)} `);
        const x = await scenario(d, s, dir);
        const j = judge(s, x);
        usd += x.out.usd ?? 0;
        console.log(`${j.verdict}${j.why ? ` (${scrub(j.why)})` : ""}  ${x.seconds}s  $${(x.out.usd ?? 0).toFixed(4)}${j.checks.filter((c) => !c.ok).map((c) => `\n      FAIL ${c.text}`).join("")}`);
        results.push({ scenario: s.id, ...j });
      }
      spent += usd;
      const sum = summarize(d, results);
      console.log(`  audit        ${sum.scenarios.at(-1).verdict}\n  => ${sum.status.toUpperCase()}  ($${usd.toFixed(4)})`);
      const prev = report.integrations[d.id];
      report.integrations[d.id] = { ...sum, usd: Number(usd.toFixed(4)), lastRunAt: now, ...(sum.status === "verified" ? { verifiedAt: now } : prev?.verifiedAt && { previouslyVerifiedAt: prev.verifiedAt }) };
      for (const alias of DRIVERS.filter((x) => x.sameAs === d.id)) report.integrations[alias.id] = { ...report.integrations[d.id], label: alias.label };
    }
  } finally {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  }
  report.usd = Number(spent.toFixed(4));
  writeFileSync(REPORT, `${scrub(JSON.stringify(report, null, 2))}\n`);
  writeFileSync(DOC, scrub(await renderDoc(report)));
  console.log(`\nspent this run: $${spent.toFixed(4)} (measured from the providers' own usage numbers, list prices)\nreport: ${path.relative(root, REPORT)}, ${path.relative(root, DOC)}`);
}

async function renderDoc(report) {
  const { INTEGRATIONS } = await import("../src/lib/integrations-catalog.ts");
  const rows = INTEGRATIONS.map((i) => {
    const r = report.integrations[i.id];
    const status = r?.status === "verified" ? "VERIFIED" : r?.status === "blocked" ? "BLOCKED" : r?.status === "failed" ? "FAILED" : !i.connect ? "PLANNED" : "NOT RUN";
    const failed = r?.scenarios?.filter((s) => s.verdict !== "PASS").map((s) => `${s.scenario}: ${s.verdict}${s.why ? ` (${s.why})` : ""}${s.failed?.length ? ` (${s.failed.join("; ")})` : ""}`).join("<br>") || "";
    return `| ${i.name} | ${status} | ${r?.label ?? ""} | ${r?.scenarios ? r.scenarios.map((s) => `${s.scenario} ${s.verdict === "PASS" ? "pass" : s.verdict.toLowerCase()}`).join(", ") : ""} | ${failed} | ${(r?.missing ?? []).join("; ")} | ${(r?.verifiedAt ?? r?.lastRunAt ?? r?.lastCheckedAt ?? "").slice(0, 16).replace("T", " ")} |`;
  });
  return `# Integration verification report

Generated by \`${report.suite}\` (scripts/verify-integrations.mjs). Do not edit by hand: rerun the suite.
Last run: ${report.generatedAt.slice(0, 16).replace("T", " ")} UTC. Spent in the last run: $${report.usd}.

Every scenario runs against an isolated TEND with a real model, framework or host, and is judged from TEND's own records and a ledger of
what actually ran. VERIFIED means all seven passed: allow, deny, approve, reject, revoke, TEND unavailable, audit log.

| Integration | Status | What was really exercised | Scenarios | Failed | Missing requirements | Last run (UTC) |
|---|---|---|---|---|---|---|
${rows.join("\n")}
`;
}

main().catch((e) => { console.error(scrub(e.stack ?? e)); process.exit(1); });
