#!/usr/bin/env node
// End-to-end check of the five-minute onboarding path over real HTTP, against an isolated server it starts itself:
// a fresh embedded database in a temp directory, a random throwaway admin token, demo off, no DATABASE_URL, fake agent.
// It runs the exact script the dashboard hands to a new user, as a separate process with a clean environment, and plays
// the part of the person at the dashboard through the operator API. Needs a build first:
//   npm run build && npm run e2e:connect
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { TEST_SCRIPT } from "../src/lib/connect-snippet.ts";

const PORT = 3960 + Math.floor(Math.random() * 9);
const URL_ = `http://127.0.0.1:${PORT}`;
const ADMIN = `fake_admin_${randomBytes(18).toString("hex")}`;
const dir = mkdtempSync(path.join(tmpdir(), "tend-connect-e2e-"));
const env = { ...process.env, TEND_ADMIN_TOKEN: ADMIN, TEND_DATA_DIR: dir, TEND_DEMO: "0", TEND_PUBLIC: "0", DATABASE_URL: "", POSTGRES_URL: "", ANTHROPIC_API_KEY: "", NODE_ENV: "production" };
const server = spawn("npx", ["next", "start", "-p", String(PORT), "-H", "127.0.0.1"], { env, stdio: ["ignore", "pipe", "pipe"] });
let serverOut = "";
server.stdout.on("data", (b) => (serverOut += b));
server.stderr.on("data", (b) => (serverOut += b));

const results = [];
const seen = []; // everything the agent-side script printed
let cookie = "";

async function call(method, p, { body, op } = {}) {
  const res = await fetch(URL_ + p, {
    method,
    headers: { ...(body !== undefined && { "content-type": "application/json" }), ...(op && { cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text, headers: res.headers };
}
async function step(name, fn) {
  try {
    await fn();
    results.push(["PASS", name]);
  } catch (e) {
    results.push(["FAIL", name, e.message.split("\n")[0]]);
  }
}

/** The dashboard's script, as its own process that sees only the address and the agent's key. */
function runScript(key) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module"], { env: { PATH: process.env.PATH, TEND_URL: URL_, TEND_AGENT_KEY: key, TEND_POLL_MS: "250" } });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => (seen.push(out, err), resolve({ code, out, err })));
    child.stdin.end(TEST_SCRIPT);
  });
}
const state = async () => (await call("GET", "/api/v1/state", { op: true })).body;
/** What the person sees in the dashboard: wait until the agent's test request is pending. */
async function pendingTest(agentId) {
  for (let i = 0; i < 80; i++) {
    const a = (await state()).projection.authorizations.find((x) => x.agentId === agentId && x.tool === "test_ping" && x.status === "pending");
    if (a) return a;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("the request never reached the dashboard");
}
const decide = (id, status) => call("POST", `/api/v1/reviews/${id}`, { op: true, body: { status } });
const gatewayCalls = async (agentId) => (await state()).projection.taskEvents.filter((t) => t.agentId === agentId && t.type === "tool.called" && t.via === "gateway");

try {
  for (let i = 0; ; i++) {
    if (server.exitCode !== null) throw new Error(`server exited: ${serverOut.slice(-500)}`);
    if (i > 120) throw new Error("server did not start within 60s");
    if (await fetch(`${URL_}/api/health`).then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const login = await call("POST", "/api/operator/session", { body: { token: ADMIN } });
  assert.equal(login.status, 200);
  cookie = login.headers.get("set-cookie").split(";")[0];

  const reg = await call("POST", "/api/v1/agents", { op: true, body: { name: "Fake Newcomer", model: "fake-model", provider: "Custom" } });
  assert.equal(reg.status, 201);
  const A = { id: reg.body.agent.id, key: reg.body.apiKey };

  await step("the guided setup page is served", async () => {
    const r = await call("GET", "/connect");
    assert.equal(r.status, 200);
  });

  await step("a new agent is not connected, and every tool, the test action included, is blocked by default", async () => {
    const s = (await state()).projection.agents.find((a) => a.id === A.id);
    assert.equal(s.lastSeenAt, undefined, "nothing has called Tend with this key yet");
    const p = await call("GET", `/api/v1/agents/${A.id}/policy`, { op: true });
    assert.equal(p.status, 200);
    assert.ok(p.body.tools.every((t) => t.effect === "deny"));
    assert.equal(p.body.tools.find((t) => t.tool === "test_ping").available, true);
    assert.equal((await call("GET", `/api/v1/agents/${A.id}/policy`)).status, 403, "visitors cannot read a policy");
  });

  await step("the script before any permission: connects, is blocked, and nothing runs", async () => {
    const r = await runScript(A.key);
    assert.equal(r.code, 2, r.err);
    assert.match(r.out, /Connected to Tend as/);
    assert.match(r.err, /blocked the test action \(no_policy\)/);
    const s = await state();
    assert.ok(s.projection.agents.find((a) => a.id === A.id).lastSeenAt, "the dashboard now sees a real connection");
    assert.equal((await gatewayCalls(A.id)).length, 0);
    assert.equal(s.projection.authorizations.filter((a) => a.agentId === A.id)[0].status, "denied");
  });

  await step("permissions: Ask me first for the test action, saved through the existing policy API", async () => {
    const before = (await call("GET", `/api/v1/agents/${A.id}/policy`, { op: true })).body;
    const r = await call("POST", `/api/v1/agents/${A.id}/policy`, { op: true, body: { rules: [{ tool: "test_ping", action: "ping", effect: "approve" }], enforcement: "enforce", expectedVersion: before.version } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const after = (await call("GET", `/api/v1/agents/${A.id}/policy`, { op: true })).body;
    assert.deepEqual(after.tools.map((t) => [t.tool, t.effect]).sort(), [["delete_test_file", "deny"], ["list_notes", "deny"], ["pay_invoice", "deny"], ["read_note", "deny"], ["read_test_file", "deny"], ["test_ping", "approve"], ["write_note", "deny"], ["write_test_file", "deny"]]);
  });

  await step("the script after approval: Tend runs the action once and the dashboard records it", async () => {
    const [run, pending] = await Promise.all([runScript(A.key), pendingTest(A.id).then(async (a) => (assert.equal((await decide(a.id, "approved")).status, 200), a))]);
    assert.equal(run.code, 0, run.err);
    assert.match(run.out, /Waiting for you to approve/);
    assert.match(run.out, /answered: pong: hello from my agent/);
    assert.equal(pending.detail, "Say: hello from my agent", "the person approves exactly what runs");
    const s = await state();
    const az = s.projection.authorizations.find((a) => a.id === pending.id);
    assert.equal(az.status, "consumed");
    const calls = await gatewayCalls(A.id);
    assert.deepEqual(calls.map((c) => [c.outcome, c.authorizationId]), [["success", pending.id]]);
    assert.equal(JSON.stringify(s).includes("pong"), false, "tool output is not stored");
  });

  await step("the script when the person rejects: nothing runs", async () => {
    const [run] = await Promise.all([runScript(A.key), pendingTest(A.id).then((a) => decide(a.id, "rejected"))]);
    assert.equal(run.code, 3);
    assert.match(run.err, /Not approved \(rejected\)\. Nothing was run\./);
    assert.equal((await gatewayCalls(A.id)).length, 1, "still only the earlier approved run");
  });

  await step("protection checks over HTTP: operators run and read them; visitors and the agent's own key cannot; results carry no secrets", async () => {
    const path = `/api/v1/agents/${A.id}/verification`;
    assert.equal((await call("GET", path, { op: true })).body.run, null, "nothing has been run yet");
    assert.equal((await call("POST", path)).status, 403, "a visitor cannot run the checks");
    assert.equal((await call("GET", path)).status, 403, "a visitor cannot read them");
    const agentKey = await fetch(URL_ + path, { method: "POST", headers: { authorization: `Bearer ${A.key}` } });
    assert.equal(agentKey.status, 403, "the agent cannot run its own checks");
    const run = await call("POST", path, { op: true });
    assert.equal(run.status, 201, JSON.stringify(run.body).slice(0, 200));
    const checks = Object.fromEntries(run.body.run.checks.map((c) => [c.id, c.status]));
    assert.equal(Object.keys(checks).length, 11);
    assert.equal(checks.agent_isolated, "not_verified");
    assert.equal(checks.ever_outside, "not_verified", "an empty record is never Verified");
    assert.equal(checks.alert_if_outside, "verified");
    assert.ok(["verified", "not_verified"].includes(checks.forbidden_refused));
    assert.ok(Object.values(checks).every((s) => ["verified", "at_risk", "not_verified"].includes(s)));
    const text = JSON.stringify(run.body);
    assert.equal(text.includes(A.key) || text.includes(ADMIN) || /tend_sk_|tend_az_|\/var\/|\/private\//.test(text), false, "a secret or path in the result");
    assert.equal((await call("GET", path, { op: true })).body.run.id, run.body.run.id);
    assert.equal((await call("GET", `/api/v1/agents/nobody/verification`, { op: true })).status, 404);
  });

  await step("secrets: the key, the admin token and tokens never appear in what the script printed or in server output", async () => {
    const all = seen.join("\n");
    assert.equal(all.includes(A.key), false);
    assert.equal(serverOut.includes(A.key), false);
    assert.equal(all.includes(ADMIN) || serverOut.includes(ADMIN), false);
    assert.equal(/tend_az_[A-Za-z0-9_-]{43}/.test(all + serverOut), false);
  });
} catch (e) {
  results.push(["FAIL", "harness", e.message]);
} finally {
  server.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 500));
  rmSync(dir, { recursive: true, force: true });
}

for (const [s, name, why] of results) console.log(`${s}  ${name}${why ? `\n      ${why}` : ""}`);
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
