#!/usr/bin/env node
// `npm run demo`: your first controlled agent action in about a minute. One command, no accounts, no files to edit.
//
// It starts a throwaway TEND (temporary database, nothing saved, gone when it ends), puts a Claude agent in front of it with three harmless
// demo tools, and shows TEND allowing one action, refusing one, and holding two for YOUR decision, right here in the terminal.
// With ANTHROPIC_API_KEY set the agent is a real Claude model (a cent or two); without it a scripted stand-in plays Claude and says so.
// The sign-in token of the throwaway TEND lives only in this process's memory: it is never printed or written anywhere.
//
//   npm run demo               you decide the two held actions (y/n)
//   npm run demo -- --auto     no questions: approves the first, rejects the second (also used when there is no terminal)
//   npm run demo -- --scripted use the scripted stand-in even if a key is set
import "./node-check.mjs";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { runClaude } from "../examples/claude-quickstart/agent.mjs";
import { SCENARIOS, scriptedClaude } from "../examples/claude-quickstart/scenarios.mjs";
import { connectTend } from "../examples/claude-quickstart/tend-client.mjs";
import { POLICY, createWorld } from "../examples/claude-quickstart/tools.mjs";
import { ensureBuilt } from "./ensure-built.mjs";
import { startIsolatedServer } from "./isolated-server.mjs";

const root = path.resolve(import.meta.dirname, "..");
const t0 = Date.now();
const secs = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const args = process.argv.slice(2);
const KEY = args.includes("--scripted") ? "" : (process.env.ANTHROPIC_API_KEY ?? "");
const MODEL = process.env.CLAUDE_MODEL ?? "claude-haiku-4-5";
const auto = args.includes("--auto") || !process.stdin.isTTY;
const ADMIN = `demo_${randomBytes(24).toString("base64url")}`; // in memory only
const say = (s = "") => console.log(s);
const scrub = (s) => [ADMIN, KEY].filter(Boolean).reduce((t, x) => t.split(x).join("[hidden]"), String(s));
const fail = (msg) => { console.error(`\n${scrub(msg)}`); process.exitCode = 1; };

let server, dataDir, rl;
const cleanup = async () => {
  rl?.close();
  await server?.stop().catch(() => {});
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
};
process.on("SIGINT", async () => { await cleanup(); process.exit(130); });

let cookie = "", URL_ = "";
async function op(method, p, body) {
  const res = await fetch(URL_ + p, { method, headers: { ...(body !== undefined && { "content-type": "application/json" }), cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

async function main() {
  say("TEND demo: watch a Claude agent being controlled.\n");
  await ensureBuilt();
  dataDir = mkdtempSync(path.join(tmpdir(), "tend-demo-"));
  server = await startIsolatedServer({ root, env: { TEND_ADMIN_TOKEN: ADMIN, TEND_DATA_DIR: dataDir, TEND_GATEWAY_SANDBOX_DIR: dataDir } });
  URL_ = server.url;
  const login = await op("POST", "/api/operator/session", { token: ADMIN });
  if (login.status !== 200) throw new Error("Could not sign in to the throwaway TEND (this is a bug in the demo).");
  cookie = login.headers.get("set-cookie").split(";")[0];
  const reg = await op("POST", "/api/v1/agents", { name: "Claude demo agent", model: MODEL, provider: "Anthropic" });
  const agent = { id: reg.body.agent.id, key: reg.body.apiKey };
  if ((await op("POST", `/api/v1/agents/${agent.id}/policy`, { rules: POLICY, enforcement: "enforce" })).status !== 200) throw new Error("Could not set the demo policy.");

  let client, usage = { in: 0, out: 0, calls: 0 };
  if (KEY) { const { default: Anthropic } = await import("@anthropic-ai/sdk"); client = new Anthropic({ apiKey: KEY, maxRetries: 1 }); }
  else client = scriptedClaude();
  say(`TEND is running at ${URL_} (temporary, only on this computer).`);
  say(KEY ? `The agent is a REAL Claude model (${MODEL}); expect about a cent of API usage.` : "No ANTHROPIC_API_KEY is set, so a SCRIPTED stand-in plays Claude. TEND itself is real. (Real Claude: see the end.)");
  say(`Your policy: reading a note is allowed, sending an email needs you, deleting a record is never allowed.\n`);

  rl = auto ? null : readline.createInterface({ input: process.stdin, output: process.stdout });
  const world = createWorld();
  const rows = [];
  let firstAt = "";
  const demo = SCENARIOS.filter((s) => s.id !== "revoke");
  for (const [n, s] of demo.entries()) {
    say(`${n + 1}/${demo.length}  ${s.title}`);
    say(`    You ask Claude: "${s.prompt.split(". If")[0]}"`);
    const before = { runs: { ...world.runs }, sent: world.outbox.length };
    let humanSaid = "";
    const gate = connectTend({
      url: URL_, key: agent.key, pollMs: 300, approvalTimeoutMs: 120_000,
      onPending: async (authId) => {
        const a = ((await op("GET", "/api/v1/state")).body.projection.authorizations).find((x) => x.id === authId);
        say(`    TEND is HOLDING this action. Nothing has happened yet. Claude wants to:\n        ${a?.detail ?? `${a?.tool} ${a?.resource}`}`);
        let yes = s.decision === "approve";
        if (rl) yes = /^y/i.test((await rl.question(`    Allow this exact action once? [y/N]  (suggested: ${s.hint}) `)).trim());
        humanSaid = yes ? "you allowed it" : "you said no";
        await op("POST", `/api/v1/reviews/${authId}`, { status: yes ? "approved" : "rejected" });
      },
    });
    const r = await runClaude({ client, gate, world, prompt: s.prompt, model: MODEL, onUsage: (u) => { usage.in += u.input_tokens; usage.out += u.output_tokens; usage.calls++; } });
    if (r.errors.length) throw new Error(r.errors[0]);
    const o = r.outcomes.find((x) => x.tool === s.expect.tool);
    if (!o) { rows.push({ s, tried: false }); say("    Claude did not try that tool this time, so there is nothing to show for this step.\n"); continue; }
    const ran = world.runs[s.expect.tool] > before.runs[s.expect.tool];
    const verdict = o.executed ? (humanSaid ? "approved by you, then ran" : "allowed by policy, ran") : o.outcome === "denied" ? (o.reason === "policy_denied" ? "DENIED by policy, never ran" : `denied (${o.reason})`) : o.outcome === "rejected" ? "REJECTED by you, never ran" : `not executed (${o.outcome}${o.detail ? `: ${o.detail}` : ""})`;
    say(`    TEND: ${verdict}.`);
    if (r.final) say(`    Claude says: ${scrub(r.final).replace(/\s+/g, " ").slice(0, 200)}`);
    say();
    firstAt ||= secs();
    rows.push({ s, tried: true, o, ran, humanSaid, ok: o.executed === ran && (o.executed ? true : !ran) && (s.id !== "deny" || !ran) });
  }
  rl?.close(); rl = null;

  const st = (await op("GET", "/api/v1/state")).body.projection;
  say("What TEND recorded (its audit log):");
  for (const l of st.log.filter((x) => x.agentId === agent.id && /^authorization_/.test(x.type)).reverse()) say(`    - ${l.summary}`);
  say();
  const tried = rows.filter((x) => x.tried);
  const problems = tried.filter((x) => !x.ok);
  say(problems.length || !tried.length
    ? `RESULT: ${tried.length ? "something did not behave as expected" : "Claude never tried any tool, so nothing was shown"}. Run it again.`
    : `RESULT: all ${tried.length} actions were controlled correctly: only what policy or you allowed ever ran (the email list has ${world.outbox.length} email${world.outbox.length === 1 ? "" : "s"}; the record ${world.records["R-7"] ? "is still there" : "is gone"}).`);
  say(`First controlled action after ${firstAt || "n/a"}; the whole demo took ${secs()}.${KEY ? ` Claude usage: ${usage.calls} calls, ${usage.in + usage.out} tokens, about $${((usage.in * 1 + usage.out * 5) / 1e6).toFixed(3)}.` : ""}`);
  say("\nNext:");
  say("  Use your own Claude agent:  see README.md, section \"Put TEND in front of your own agent\" (about 3 lines of code).");
  if (!KEY) say("  Try real Claude:            read -rs ANTHROPIC_API_KEY && export ANTHROPIC_API_KEY   (paste the key, Enter; nothing is shown), then npm run demo");
  say("  Run a TEND with a dashboard: npm run tester:init -- yourname && npm run dev   (README, step 3)");
  if (problems.length) process.exitCode = 1;
}

try {
  await main();
} catch (e) {
  fail(KEY && /Anthropic|api\.anthropic|ANTHROPIC/.test(e.message) ? e.message : (e.message ?? e));
} finally {
  await cleanup();
}
