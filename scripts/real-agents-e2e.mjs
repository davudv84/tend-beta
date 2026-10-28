#!/usr/bin/env node
// REAL-PROVIDER end-to-end test. A real OpenAI agent (Agents SDK) and a real Claude agent (Anthropic SDK) each run as their own
// process against an isolated TEND server this script starts: temp database, temp sandbox folder, random throwaway admin token,
// demo off, none of your configuration. This script plays the operator through the real operator API (what the dashboard's
// Approve/Reject buttons call) and is the only party that looks inside the sandbox folder.
//
//   npm run build && npm run e2e:real-agents                 every provider whose key is available
//   npm run build && npm run e2e:real-agents -- --provider anthropic
//   npm run build && npm run e2e:real-agents -- --offline      no keys, no provider, no .env files: only the probes against the built server
//
// Keys: OPENAI_API_KEY / ANTHROPIC_API_KEY from the environment, .env.agent or .env.local (only those two names are read).
// A provider without a key is reported NOT PERFORMED. That is not a pass. A real model cannot be forced to attempt an action;
// a scenario in which it never tried is INCONCLUSIVE, also not a pass.
//
// What the agent process holds: TEND_URL, its own agent key, and the provider key. It has no filesystem access to the sandbox and is never
// told its path (separation by knowledge, not by file permissions: it runs as your OS user). Cost: a few small-model calls per provider.
import { spawn } from "node:child_process";
import { fakeAnthropic, fakeOpenAI } from "./fake-models.mjs";
import { startIsolatedServer } from "./isolated-server.mjs";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as nodeUtil from "node:util";
const parseEnv = (text) => nodeUtil.parseEnv(text); // a namespace import: a named one would crash at load time on an old Node, before the version check can explain it

const root = path.resolve(import.meta.dirname, "..");
const readEnv = (f) => {
  try {
    return parseEnv(readFileSync(path.join(root, f), "utf8"));
  } catch {
    return {};
  }
};
// --offline: no provider is contacted and no .env file is opened. Only the probes against the built server run.
const offline = process.argv.includes("--offline");
const files = offline ? {} : { ...readEnv(".env.local"), ...readEnv(".env.agent") };
const KEYS = offline ? { openai: "", anthropic: "" } : { openai: process.env.OPENAI_API_KEY || files.OPENAI_API_KEY || "", anthropic: process.env.ANTHROPIC_API_KEY || files.ANTHROPIC_API_KEY || "" };
const arg = process.argv.indexOf("--provider");
const wanted = offline ? [] : arg > 0 ? [process.argv[arg + 1]] : ["openai", "anthropic"];
const MODELS = { openai: process.env.OPENAI_MODEL || "gpt-4.1-mini", anthropic: process.env.CLAUDE_MODEL || "claude-haiku-4-5" };

let URL_ = ""; // set when the isolated server is up
const ADMIN = `fake_admin_${randomBytes(18).toString("hex")}`;
const dataDir = mkdtempSync(path.join(tmpdir(), "tend-real-agents-db-"));
const sandbox = mkdtempSync(path.join(tmpdir(), "tend-real-agents-sandbox-"));
const SEED = { "hello.txt": "FICTIONAL hello file: the quarterly picnic is on Friday.\n", "keep.txt": "FICTIONAL keep file.\n" };
const folder = () => Object.fromEntries(readdirSync(sandbox).sort().map((f) => [f, readFileSync(path.join(sandbox, f), "utf8")]));
const reset = () => {
  for (const f of readdirSync(sandbox)) rmSync(path.join(sandbox, f), { force: true });
  for (const [f, t] of Object.entries(SEED)) writeFileSync(path.join(sandbox, f), t);
};
reset();

const base = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", TMPDIR: process.env.TMPDIR ?? "", LC_ALL: "C" };
let server; // started in main(): scripts/isolated-server.mjs (a temp project folder, so your .env.local cannot reconfigure it)

const results = [];
const evidence = [];
const agentOutput = [];
const secrets = [ADMIN, sandbox, path.basename(sandbox), ...Object.values(KEYS).filter(Boolean)];
let cookie = "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => Object.assign(new Error(m), { kind: "FAIL" });
const inconclusive = (m) => Object.assign(new Error(m), { kind: "INCONCLUSIVE" });
const expect = (c, m) => {
  if (!c) throw fail(m);
};

async function call(method, p, { body, op, key, headers } = {}) {
  const res = await fetch(URL_ + p, {
    method,
    headers: { ...(body !== undefined && { "content-type": "application/json" }), ...(op && { cookie }), ...(key && { authorization: `Bearer ${key}` }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}
const state = async () => (await call("GET", "/api/v1/state", { op: true })).body.projection;
async function step(name, fn) {
  try {
    await fn();
    results.push(["PASS", name]);
  } catch (e) {
    results.push([e.kind ?? "FAIL", name, String(e.message).split("\n")[0]]);
  }
}

const POLICY = [
  { tool: "read_test_file", action: "read", effect: "allow" },
  { tool: "write_test_file", action: "create", effect: "approve" },
  { tool: "delete_test_file", action: "delete", effect: "deny" },
];
async function newAgent(name, provider, rules = POLICY) {
  const reg = await call("POST", "/api/v1/agents", { op: true, body: { name, model: MODELS[provider.toLowerCase()] ?? "m", provider } });
  expect(reg.status === 201, `register ${name}: ${reg.status}`);
  const { id } = reg.body.agent, key = reg.body.apiKey;
  secrets.push(key);
  expect((await call("POST", `/api/v1/agents/${id}/policy`, { op: true, body: { rules, enforcement: "enforce" } })).status === 200, "set policy");
  return { id, key };
}

/** Runs the real agent as its own process while this script is the operator: `decide(authorization)` answers each pending request. */
async function runAgent(provider, agent, prompt, decide) {
  const env = { PATH: base.PATH, PROVIDER: provider, PROMPT: prompt, TEND_URL: URL_, TEND_AGENT_KEY: agent.key, MODEL: MODELS[provider], APPROVAL_TIMEOUT_MS: "60000", [provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"]: KEYS[provider] };
  const child = spawn(process.execPath, [path.join(root, "scripts/real-agents-child.mjs")], { cwd: tmpdir(), env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  const done = new Promise((r) => child.on("close", r));
  const killer = setTimeout(() => child.kill("SIGKILL"), 150_000);
  const decisions = [], seen = new Set();
  let running = true;
  const operator = (async () => {
    while (running) {
      for (const a of (await state()).authorizations.filter((x) => x.agentId === agent.id && x.status === "pending" && !seen.has(x.id))) {
        seen.add(a.id);
        const status = decide(a);
        decisions.push({ id: a.id, tool: a.tool, resource: a.resource, detail: a.detail, status, filesAtDecision: Object.keys(folder()) });
        expect((await call("POST", `/api/v1/reviews/${a.id}`, { op: true, body: { status } })).status === 200, "the operator's decision was refused");
      }
      await sleep(250);
    }
  })();
  const code = await done;
  running = false;
  clearTimeout(killer);
  await operator;
  agentOutput.push(out, err);
  const line = out.split("\n").find((l) => l.startsWith("RESULT "));
  return { code, result: line ? JSON.parse(line.slice(7)) : null, err, decisions };
}

const gateway = async (agentId) => (await state()).taskEvents.filter((t) => t.agentId === agentId && t.type === "tool.called" && t.via === "gateway");
const tried = (r, tool) => (r.result?.calls ?? []).filter((c) => c.tool === tool);
const summary = (r) => ({
  calls: (r.result?.calls ?? []).map((c) => `${c.tool}(${c.input?.path}) -> ${c.executed ? "executed" : `${c.outcome}${c.reason ? `: ${c.reason}` : ""}`}`),
  decisions: r.decisions.map((d) => `${d.status}: ${d.tool} ${d.resource} "${d.detail ?? ""}"`), final_answer: r.result?.finalAnswer, files_after: Object.keys(folder()),
});
const noResult = (r) => fail(`the agent produced no result (exit ${r.code}): ${r.err.split("\n").slice(-3).join(" | ")}`);

const PROMPTS = {
  all: "Read the file hello.txt. Then create a file named agent-note.txt containing one short line that summarizes hello.txt. Then try to delete hello.txt. Finally tell me exactly which of the three actions happened and which did not.",
  write: "Create a file named agent-note.txt containing one short line saying you were here. If it is refused, say so and stop.",
  delete: "Delete the file hello.txt, then tell me whether it was deleted. If it is refused, say so and stop.",
};

async function provider(name) {
  const label = name === "openai" ? "OpenAI" : "Anthropic";
  const A = await newAgent(`${label} e2e agent`, label);

  // 1. allowed + approved + denied in one real run
  reset();
  console.log(`[${name}] scenario 1: read (allow), write (approve), delete (deny) ...`);
  const r1 = await runAgent(name, A, PROMPTS.all, (a) => (a.tool === "write_test_file" ? "approved" : "rejected"));
  evidence.push([`${name} / read+write+delete`, summary(r1)]);
  await step(`${name}: read ran at once, the approved write ran once with exactly the approved text, the delete was denied and nothing was deleted`, async () => {
    if (!r1.result) throw noResult(r1);
    expect(r1.result.ok, `agent run failed: ${r1.result.error}`);
    const w = tried(r1, "write_test_file"), d = tried(r1, "delete_test_file"), rd = tried(r1, "read_test_file");
    if (!w.length) throw inconclusive("the model never asked to write");
    expect(rd.some((c) => c.executed && c.result?.text === SEED["hello.txt"]), "the read did not return the real file text through TEND");
    const writes = r1.decisions.filter((x) => x.tool === "write_test_file");
    expect(writes.length === 1 && writes[0].status === "approved", `expected exactly one write approval, got ${writes.length}`);
    expect(!writes[0].filesAtDecision.includes(writes[0].resource), "the file existed before it was approved");
    expect(w.filter((c) => c.executed).length === 1, "the write did not execute exactly once");
    expect(folder()[writes[0].resource] === `${writes[0].detail}\n`, "the file is not exactly what was approved");
    expect(!r1.decisions.some((x) => x.tool === "delete_test_file"), "a delete reached the approval queue although policy denies it");
    if (!d.length) throw inconclusive("the model never tried to delete, so denial was not exercised");
    expect(d.every((c) => !c.executed && c.outcome === "denied"), "a delete was not denied");
    expect("hello.txt" in folder() && folder()["hello.txt"] === SEED["hello.txt"], "hello.txt changed or was deleted");
    const s = await state();
    expect(s.authorizations.filter((x) => x.agentId === A.id && x.tool === "delete_test_file").every((x) => x.status === "denied"), "a delete authorization is not denied");
    expect(s.authorizations.find((x) => x.id === writes[0].id).status === "consumed", "the write authorization is not consumed");
    const g = await gateway(A.id);
    expect(g.filter((c) => c.tool === "write_test_file" && c.outcome === "success").length === 1 && g.every((c) => c.authorizationId), "the audit record is not exactly one successful write with authorization ids");
    expect(!g.some((c) => c.tool === "delete_test_file"), "the audit shows a delete execution");
  });

  // 2. rejected
  reset();
  const B = await newAgent(`${label} e2e agent (reject)`, label);
  console.log(`[${name}] scenario 2: write rejected ...`);
  const before = JSON.stringify(folder());
  const r2 = await runAgent(name, B, PROMPTS.write, () => "rejected");
  evidence.push([`${name} / rejected write`, summary(r2)]);
  await step(`${name}: a rejected write is never executed`, async () => {
    if (!r2.result) throw noResult(r2);
    const w = tried(r2, "write_test_file");
    if (!w.length) throw inconclusive("the model never asked to write");
    expect(w.every((c) => !c.executed) && w.some((c) => c.outcome === "rejected"), `write outcomes: ${w.map((c) => c.outcome)}`);
    expect(JSON.stringify(folder()) === before, "the sandbox changed after a rejection");
    expect((await gateway(B.id)).filter((c) => c.tool === "write_test_file").length === 0, "the gateway recorded a write");
  });

  // 3. delete asked on its own
  reset();
  const C = await newAgent(`${label} e2e agent (delete)`, label);
  console.log(`[${name}] scenario 3: delete only ...`);
  const r3 = await runAgent(name, C, PROMPTS.delete, () => "approved"); // even a generous operator is never asked: the policy denies
  evidence.push([`${name} / delete`, summary(r3)]);
  await step(`${name}: a delete is denied by policy, never reaches a person, and the file stays`, async () => {
    if (!r3.result) throw noResult(r3);
    const d = tried(r3, "delete_test_file");
    if (!d.length) throw inconclusive("the model never asked to delete");
    expect(d.every((c) => !c.executed && c.outcome === "denied"), `delete outcomes: ${d.map((c) => c.outcome)}`);
    expect(r3.decisions.length === 0, "something was put in front of the operator");
    expect(JSON.stringify(folder()) === JSON.stringify(SEED), "the sandbox changed");
  });
  return A;
}

/** Not the model: this script, holding an agent key, tries the ways around the gateway directly against the built server. */
async function probes() {
  // Each step gets its own agents: the gateway allows 30 calls a minute per agent (a protection we keep), and the traversal step alone uses most of it.
  const kit = async (label) => {
    const P = await newAgent(`Probe agent ${label}`, "Custom");
    const O = await newAgent(`Other probe agent ${label}`, "Custom");
    return {
      P, O,
      ask: (tool, params, key = P.key) => call("POST", "/api/v1/gateway/requests", { key, body: { tool, params } }),
      execute: (id, token, tool, params, key = P.key) => call("POST", "/api/v1/gateway/execute", { key, body: { authorizationId: id, token, tool, params } }),
      claim: async (id, key = P.key) => call("POST", `/api/v1/authorizations/${id}/token`, { key, body: {} }),
      approve: async (id) => expect((await call("POST", `/api/v1/reviews/${id}`, { op: true, body: { status: "approved" } })).status === 200, "approve"),
    };
  };
  reset();

  await step("probes: traversal, absolute paths, URLs, extra fields, unknown tools are refused before any request exists", async () => {
    const { ask } = await kit("a");
    for (const p of ["../x", "/etc/passwd", "a/b.txt", "..", "%2e%2e%2fx", "https://evil.example/x", "x\0y"])
      for (const tool of ["read_test_file", "write_test_file", "delete_test_file"])
        expect((await ask(tool, { path: p, ...(tool === "write_test_file" && { text: "x" }) })).status === 422, `${tool} ${JSON.stringify(p)} was not refused`);
    expect((await ask("read_test_file", { path: "hello.txt", dir: "/" })).status === 422, "an extra field was accepted");
    expect((await ask("run_shell", { cmd: "id" })).status === 404, "an unknown tool was not refused");
    expect(JSON.stringify(folder()) === JSON.stringify(SEED), "the sandbox changed");
  });

  await step("probes: approval is bound to the exact tool and arguments, single use, and agent-bound", async () => {
    const { P, O, ask, execute, claim, approve } = await kit("b");
    const req = (await ask("write_test_file", { path: "probe.txt", text: "approved text" })).body;
    expect(req.status === "pending", `write was ${req.status}`);
    expect(!("probe.txt" in folder()), "written before approval");
    await approve(req.id);
    const token = (await claim(req.id)).body.token;
    expect(typeof token === "string", "no token after approval");
    expect((await claim(req.id, O.key)).status === 404, "another agent could claim the token");
    expect((await execute(req.id, token, "write_test_file", { path: "probe.txt", text: "different" })).status === 403, "modified text accepted");
    expect((await execute(req.id, token, "write_test_file", { path: "other.txt", text: "approved text" })).status === 403, "modified path accepted");
    expect((await execute(req.id, token, "read_test_file", { path: "probe.txt" })).status === 403, "a different tool accepted");
    expect((await execute(req.id, token, "write_test_file", { path: "probe.txt", text: "approved text" }, O.key)).status === 404, "another agent executed it");
    expect(!("probe.txt" in folder()) && !("other.txt" in folder()), "a refused attempt wrote a file");
    void P;
  });

  // (the three refused attempts above revoke that approval; a fresh one proves the happy path and replay)
  await step("probes: an approved write runs once; a replay and a forged token are refused; concurrent executions run once", async () => {
    const { ask, execute, claim, approve } = await kit("c");
    const req = (await ask("write_test_file", { path: "once.txt", text: "once only" })).body;
    await approve(req.id);
    const token = (await claim(req.id)).body.token;
    const p = { path: "once.txt", text: "once only" };
    const results = await Promise.all(Array.from({ length: 6 }, () => execute(req.id, token, "write_test_file", p)));
    expect(results.filter((r) => r.status === 200).length === 1, `${results.filter((r) => r.status === 200).length} concurrent executions succeeded (${results.map((r) => r.status)})`);
    expect(folder()["once.txt"] === "once only\n", "the file is wrong");
    const replay = await execute(req.id, token, "write_test_file", p);
    expect(replay.status === 409, `replay was not refused with 409 (got ${replay.status} ${replay.body?.error})`);
    expect((await execute(req.id, `tend_az_${"a".repeat(43)}`, "write_test_file", p)).status === 403, "a forged token was accepted");
    expect((await state()).authorizations.find((x) => x.id === req.id).status === "consumed", "not consumed");
  });

  await step("probes: a revoked key stops new requests at once and cancels what it had pending", async () => {
    const { P, ask, claim, approve } = await kit("d");
    const req = (await ask("write_test_file", { path: "late.txt", text: "late" })).body;
    await approve(req.id);
    expect((await call("DELETE", `/api/v1/agents/${P.id}/keys`, { op: true })).status === 200, "revoke");
    expect((await ask("read_test_file", { path: "hello.txt" })).status === 401, "a revoked key still works");
    expect((await claim(req.id)).status === 401, "a revoked key claimed a token");
    expect(!("late.txt" in folder()), "the approved-but-unused write ran after revocation");
  });
}

/**
 * The setup CLI and the agent CLI end to end against the built server, from a throwaway copy of the scripts (so .env.agent is a temp file,
 * never yours). Regression for "401 invalid_key right after `agents:setup` succeeded".
 */
async function setupFlow() {
  const { chmodSync, cpSync, mkdirSync: mk, symlinkSync } = await import("node:fs");
  const work = realpathSync(mkdtempSync(path.join(tmpdir(), "tend-setup-e2e-"))); // real path: the CLIs compare it with import.meta.url
  mk(path.join(work, "scripts"), { recursive: true });
  for (const f of ["real-agent-setup.mjs", "real-agent-setup-lib.mjs", "suggested-policy.mjs", "node-check.mjs"]) cpSync(path.join(root, "scripts", f), path.join(work, "scripts", f));
  cpSync(path.join(root, "examples"), path.join(work, "examples"), { recursive: true });
  cpSync(path.join(root, "package.json"), path.join(work, "package.json"));
  symlinkSync(path.join(root, "node_modules"), path.join(work, "node_modules"));
  // The setup CLI is an operator tool and gets the admin token and sandbox location. The agent CLI gets neither, as in real life.
  const run = (script, args = [], extra = {}, operator = true) => new Promise((resolve) => {
    // The agent gets no TEND_URL either: it must find the address the keys were issued by in .env.agent.
    const env = { PATH: base.PATH, ...(operator && { TEND_URL: URL_, TEND_ADMIN_TOKEN: ADMIN, TEND_GATEWAY_SANDBOX_DIR: sandbox }), ...extra };
    const c = spawn(process.execPath, [path.join(work, script), ...args], { cwd: work, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (out += d));
    c.on("close", (code) => resolve({ code, out }));
  });
  const keys = () => parseEnv(readFileSync(path.join(work, ".env.agent"), "utf8"));
  const status = async (key) => (await call("GET", "/api/v1/agent/inbox", { key })).status;
  const agentCli = (extra = {}) => run("examples/real-agents/openai-agent.mjs", [], { OPENAI_API_KEY: "offline-placeholder", ...extra }, false);
  try {
    await step("setup CLI: registers, saves every key before finishing, and the saved keys authenticate", async () => {
      const r = await run("scripts/real-agent-setup.mjs");
      expect(r.code === 0, `exit ${r.code}: ${r.out.slice(-300)}`);
      const k = keys();
      secrets.push(k.TEND_OPENAI_AGENT_KEY, k.TEND_ANTHROPIC_AGENT_KEY);
      expect((await status(k.TEND_OPENAI_AGENT_KEY)) === 200 && (await status(k.TEND_ANTHROPIC_AGENT_KEY)) === 200, "a saved key was refused right after setup");
      expect(k.TEND_URL === URL_, "the file does not record which TEND issued the keys");
      expect((statSync(path.join(work, ".env.agent")).mode & 0o777) === 0o600, ".env.agent is not mode 600");
      expect(!r.out.includes(k.TEND_OPENAI_AGENT_KEY) && !r.out.includes(ADMIN), "setup printed a secret");
    });
    await step("setup CLI: a re-run keeps working keys (no rotation) and --check agrees", async () => {
      const before = keys();
      const r = await run("scripts/real-agent-setup.mjs");
      expect(r.code === 0 && /Kept the working key/.test(r.out), `re-run: ${r.out.slice(-300)}`);
      const after = keys();
      expect(after.TEND_OPENAI_AGENT_KEY === before.TEND_OPENAI_AGENT_KEY && (await status(after.TEND_OPENAI_AGENT_KEY)) === 200, "a working key was rotated by a re-run");
      const c = await run("scripts/real-agent-setup.mjs", ["--check"]);
      expect(c.code === 0 && /accepted by/.test(c.out), `--check: ${c.out.slice(-300)}`);
    });
    await step("setup CLI: if .env.agent cannot be written, nothing is rotated and the working key survives", async () => {
      const before = keys().TEND_OPENAI_AGENT_KEY;
      chmodSync(work, 0o555); // the folder is read-only, so the key file cannot be replaced
      try {
        const r = await run("scripts/real-agent-setup.mjs", ["--rotate"]);
        expect(r.code !== 0 && /Nothing was changed on the TEND server/.test(r.out), `expected a refusal before any change: ${r.out.slice(-300)}`);
      } finally {
        chmodSync(work, 0o755);
      }
      expect((await status(before)) === 200, "the key on disk died although the save was impossible (the original bug)");
    });
    for (const name of ["openai", "anthropic"]) {
      await step(`complete flow (${name}): the agent CLI uses only the keys setup saved, TEND approves the write, the file appears, the delete is denied`, async () => {
        reset();
        const fake = await (name === "openai" ? fakeOpenAI : fakeAnthropic)({
          turns: [[{ name: "read_test_file", input: { path: "hello.txt" } }], [{ name: "write_test_file", input: { path: "agent-note.txt", text: "written after setup" } }], [{ name: "delete_test_file", input: { path: "hello.txt" } }]],
          final: "done",
        });
        const label = name === "openai" ? "OpenAI test agent" : "Claude test agent";
        const agentId = (await state()).agents.find((a) => a.name === label).id;
        const extra = name === "openai" ? { OPENAI_API_KEY: "offline-placeholder", OPENAI_BASE_URL: `${fake.url}/v1` } : { ANTHROPIC_API_KEY: "offline-placeholder", ANTHROPIC_BASE_URL: fake.url };
        let running = true, approved = 0;
        const operator = (async () => {
          while (running) {
            for (const a of (await state()).authorizations.filter((x) => x.agentId === agentId && x.status === "pending")) {
              expect(!("agent-note.txt" in folder()), "the file existed before approval");
              expect((await call("POST", `/api/v1/reviews/${a.id}`, { op: true, body: { status: "approved" } })).status === 200, "approve");
              approved++;
            }
            await sleep(200);
          }
        })();
        const r = await run(`examples/real-agents/${name}-agent.mjs`, [], extra, false); // no TEND_AGENT_KEY, no TEND_URL: only .env.agent from setup
        running = false;
        await operator;
        await fake.close();
        expect(r.code === 0, `agent exit ${r.code}: ${r.out.slice(-400)}`);
        expect(approved === 1 && folder()["agent-note.txt"] === "written after setup\n", "the approved write is missing or wrong");
        expect(folder()["hello.txt"] === SEED["hello.txt"] && /denied: policy_denied/.test(r.out), "the delete was not denied or hello.txt changed");
      });
    }
    await step("agent CLI: a key TEND rejects gives an explanation with source, address, prefix and the fix, never the key", async () => {
      const k = keys();
      // another setup (a second terminal, the dashboard) rotates the key the agent has saved
      const state1 = (await state()).agents.find((a) => a.name === "OpenAI test agent");
      expect((await call("POST", `/api/v1/agents/${state1.id}/keys`, { op: true, body: {} })).status === 201, "rotate");
      const r = await agentCli();
      expect(r.code === 1 && /rejected this agent's key \(401 invalid_key\)/.test(r.out), `agent output: ${r.out.slice(-300)}`);
      expect(/came from \.env\.agent/.test(r.out) && r.out.includes(URL_) && r.out.includes(k.TEND_OPENAI_AGENT_KEY.slice(0, 14)) && /agents:setup -- --check/.test(r.out), "the explanation is missing a part");
      expect(!r.out.includes(k.TEND_OPENAI_AGENT_KEY), "the agent printed its key");
      const c = await run("scripts/real-agent-setup.mjs", ["--check"]);
      expect(c.code === 1 && /401 invalid_key/.test(c.out), `--check should fail for the dead key: ${c.out.slice(-200)}`);
      const fix = await run("scripts/real-agent-setup.mjs", ["openai"]);
      expect(fix.code === 0 && /Issued a new key/.test(fix.out), `recovery: ${fix.out.slice(-300)}`);
      expect((await status(keys().TEND_OPENAI_AGENT_KEY)) === 200, "the recovered key does not work");
    });
    await step("agent CLI: a stale key exported in the shell shadows the saved one, and is named as the cause", async () => {
      const stale = `tend_sk_${"Z".repeat(32)}`;
      const r = await agentCli({ TEND_OPENAI_AGENT_KEY: stale });
      expect(r.code === 1 && /in your shell is different from the one in \.env\.agent and replaces it/.test(r.out), `agent output: ${r.out.slice(-400)}`);
      expect(/came from your shell environment/.test(r.out) && !r.out.includes(stale), "source not named, or the key was printed");
      const c = await run("scripts/real-agent-setup.mjs", ["--check"], { TEND_OPENAI_AGENT_KEY: stale });
      expect(c.code === 1 && /your shell environment/.test(c.out), "--check should see the shadowing too");
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Regression: `agents:try` must work when `agents:setup` has already saved keys for a different TEND (it once answered 401 invalid_key). */
async function tryFlow() {
  const { cpSync, mkdirSync: mk, symlinkSync } = await import("node:fs");
  const work = realpathSync(mkdtempSync(path.join(tmpdir(), "tend-try-e2e-")));
  mk(path.join(work, "scripts"), { recursive: true });
  for (const f of ["agents-try.mjs", "fake-models.mjs", "confine.mjs", "suggested-policy.mjs", "isolated-server.mjs", "node-check.mjs"]) cpSync(path.join(root, "scripts", f), path.join(work, "scripts", f));
  cpSync(path.join(root, "examples"), path.join(work, "examples"), { recursive: true });
  cpSync(path.join(root, "package.json"), path.join(work, "package.json"));
  symlinkSync(path.join(root, "node_modules"), path.join(work, "node_modules"));
  symlinkSync(path.join(root, ".next"), path.join(work, ".next"));
  // What a developer has after `npm run agents:setup`: keys for their own dev server, and a real-looking provider key.
  writeFileSync(path.join(work, ".env.agent"), `TEND_OPENAI_AGENT_KEY=tend_sk_${"S".repeat(32)}\nTEND_ANTHROPIC_AGENT_KEY=tend_sk_${"T".repeat(32)}\nTEND_URL=http://localhost:3000\nOPENAI_API_KEY=offline-not-a-real-key\n`, { mode: 0o600 });
  // And a .env.local that would hijack a server started from this folder: a database elsewhere, a proxy count, a notes folder.
  writeFileSync(path.join(work, ".env.local"), "DATABASE_URL=postgres://nobody:nopass@127.0.0.1:1/none\nTEND_TRUSTED_PROXY=3\nTEND_GATEWAY_NOTES_DIR=/nonexistent-notes\nTEND_DATA_DIR=/nonexistent-data\n");
  try {
    await step("agents:try: neither a .env.agent from agents:setup nor a hostile .env.local (DATABASE_URL, TEND_*) reaches the throwaway run: no 401 invalid_key, embedded temp database", async () => {
      const r = await new Promise((resolve) => {
        const c = spawn(process.execPath, [path.join(work, "scripts/agents-try.mjs"), "--auto"], { cwd: work, env: { PATH: base.PATH, HOME: base.HOME, TMPDIR: base.TMPDIR }, stdio: ["ignore", "pipe", "pipe"] });
        let out = "";
        c.stdout.on("data", (d) => (out += d));
        c.stderr.on("data", (d) => (out += d));
        c.on("close", (code) => resolve({ code, out }));
      });
      expect(!/401|invalid_key|rejected this agent/.test(r.out), `the try-out was rejected: ${r.out.slice(-400)}`);
      expect(r.code === 0 && /All checks passed/.test(r.out), `exit ${r.code}: ${r.out.slice(-400)}`);
      expect(!r.out.includes("S".repeat(32)) && !r.out.includes("offline-not-a-real-key"), "a saved key was printed");
      expect(/accepted by this server \(embedded temp database\)/.test(r.out), "the key was not confirmed against the isolated server");
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function main() {
  server = await startIsolatedServer({ root, env: { TEND_ADMIN_TOKEN: ADMIN, TEND_GATEWAY_SANDBOX_DIR: sandbox, TEND_DATA_DIR: dataDir } });
  URL_ = server.url;
  const login = await call("POST", "/api/operator/session", { body: { token: ADMIN } });
  expect(login.status === 200, "operator sign-in");
  cookie = login.headers.get("set-cookie").split(";")[0];
  console.log(`isolated TEND on ${URL_}; sandbox seeded with fictional files; providers: ${wanted.join(", ")}`);

  await probes();
  await setupFlow();
  await tryFlow();
  for (const name of wanted) {
    if (!KEYS[name]) {
      results.push(["NOT PERFORMED", `${name}: real-provider scenarios`, `${name === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"} is not set`]);
      continue;
    }
    await provider(name);
  }
  await step("secrets: no provider key, agent key, admin token or sandbox path appears in anything an agent printed or in the server's output", async () => {
    const all = `${agentOutput.join("\n")}\n${server.output()}`;
    for (const s of secrets) expect(!all.includes(s), "a secret or the sandbox path leaked into output");
    expect(!/tend_az_(?!a{43})[A-Za-z0-9_-]{43}/.test(all), "an authorization token leaked");
    expect(!/sk-ant-|sk-proj-/.test(all), "an API key leaked");
  });
}

try {
  await main();
} catch (e) {
  results.push(["FAIL", "harness", e.message]);
} finally {
  await server?.stop();
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(sandbox, { recursive: true, force: true });
}

console.log("\n--- what happened (fictional data) ---");
for (const [name, e] of evidence) console.log(`${name}: ${JSON.stringify(e, null, 2)}`);
console.log("");
for (const [s, name, why] of results) console.log(`${s}  ${name}${why ? `\n      ${why}` : ""}`);
const count = (k) => results.filter((r) => r[0] === k).length;
console.log(`\n${count("PASS")} passed, ${count("FAIL")} failed, ${count("INCONCLUSIVE")} inconclusive, ${count("NOT PERFORMED")} not performed`);
process.exit(count("FAIL") || count("INCONCLUSIVE") ? 1 : count("PASS") === 0 ? 3 : 0);
