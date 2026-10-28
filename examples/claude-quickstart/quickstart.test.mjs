import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { test } from "node:test";
import { parseAuthRequest } from "../../src/server/policy.ts";
import { apiProblem } from "./agent.mjs";
import { SCENARIOS } from "./scenarios.mjs";
import { connectTend } from "./tend-client.mjs";
import { POLICY, TOOLS, createWorld, plan } from "./tools.mjs";

const repo = path.resolve(import.meta.dirname, "../..");

test("every request a demo tool can make is valid for TEND, even at the longest inputs, and what runs is exactly what was asked", () => {
  const world = createWorld();
  const longest = { id: "N-999", to: "team-99", subject: "s".repeat(50), body: "b".repeat(100) };
  for (const [name, input] of [["read_demo_note", { id: longest.id }], ["send_demo_email", longest], ["delete_demo_record", { id: "R-999" }]]) {
    const p = plan(world, name, input);
    const parsed = parseAuthRequest(p.req);
    assert.ok(parsed.ok, `${name}: ${parsed.errors?.join("; ")}`);
  }
  const p = plan(world, "send_demo_email", { to: "team-1", subject: "Hi", body: "There" });
  assert.equal(p.req.detail, "To team-1; subject: Hi; body: There");
  assert.equal(world.outbox.length, 0, "planning runs nothing");
  p.run();
  assert.deepEqual(world.outbox, [{ to: "team-1", subject: "Hi", body: "There" }]);
  assert.equal(plan(world, "rm_rf", {}), null, "an unknown tool has no plan");
});

test("the demo policy covers every tool exactly once: read allowed, email needs a person, delete never", () => {
  assert.deepEqual(POLICY.map((r) => r.tool).sort(), TOOLS.map((t) => t.name).sort());
  assert.deepEqual(Object.fromEntries(POLICY.map((r) => [r.tool, r.effect])), { read_demo_note: "allow", send_demo_email: "approve", delete_demo_record: "deny" });
  assert.deepEqual(SCENARIOS.map((s) => s.id), ["allow", "deny", "approve", "reject", "revoke"]);
});

test("connectTend says what to do when the key is missing", () => {
  assert.throws(() => connectTend({ key: "" }), /TEND_AGENT_KEY is not set[\s\S]*tester:agent/);
});

test("a TEND that is not running gives an actionable explanation, and nothing runs", async () => {
  const gate = connectTend({ url: "http://127.0.0.1:1", key: "tend_sk_x", retries: 0 });
  let ran = false;
  const r = await gate.run({ tool: "t", action: "a" }, () => (ran = true));
  assert.equal(r.executed, false);
  assert.equal(r.outcome, "unavailable");
  assert.match(r.detail, /not reachable at http:\/\/127\.0\.0\.1:1[\s\S]*npm run dev/);
  assert.equal(ran, false);
});

/** A tiny stand-in TEND that answers every request with one fixed status and body. */
const stub = (status, body) => new Promise((resolve) => { const s = createServer((_, res) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); }); s.listen(0, "127.0.0.1", () => resolve(s)); });

test("a rejected agent key and an invalid request each come back with a reason in words", async () => {
  for (const [status, body, want] of [
    [401, { error: "invalid_key", message: "bad key" }, /does not accept this agent key[\s\S]*tester:agent/],
    [422, { error: "invalid_request", message: "did not validate", errors: ["resource must be 1–64 characters of letters, digits, _ . : -"] }, /resource must be 1–64 characters/],
  ]) {
    const s = await stub(status, body);
    try {
      const r = await connectTend({ url: `http://127.0.0.1:${s.address().port}`, key: "tend_sk_x", retries: 0 }).run({ tool: "t", action: "a", resource: "a@b" }, () => assert.fail("must not run"));
      assert.equal(r.executed, false);
      assert.equal(r.outcome, "refused");
      assert.match(r.detail, want);
    } finally {
      s.close();
    }
  }
});

test("Anthropic API failures become sentences that say what to do", () => {
  assert.match(apiProblem({ status: 401 }), /ANTHROPIC_API_KEY/);
  assert.match(apiProblem({ status: 429 }), /rate limiting/);
  assert.match(apiProblem({ status: 404 }), /CLAUDE_MODEL/);
  assert.match(apiProblem({ status: 503 }), /server problem/);
  assert.match(apiProblem(new TypeError("fetch failed")), /Check the internet connection/);
});

test("an unsupported Node version stops the command-line tools with one clear sentence", () => {
  const run = (v) => spawnSync(process.execPath, [path.join(repo, "scripts/node-check.mjs")], { env: { ...process.env, TEND_NODE_VERSION_FOR_TEST: v }, encoding: "utf8" });
  for (const v of ["18.19.0", "20.11.1", "16.0.0"]) {
    const r = run(v);
    assert.equal(r.status, 2, v);
    assert.match(r.stderr, new RegExp(`needs Node 20\\.12 or newer, and this is Node ${v.replace(/\./g, "\\.")}`));
  }
  for (const v of ["20.12.0", "20.19.5", "22.1.0", "24.0.0"]) assert.equal(run(v).status, 0, v);
});

const built = existsSync(path.join(repo, ".next/BUILD_ID")) ? false : "needs `npm run build`";
test("npm run demo (scripted, no key): all four behaviours, and no secret in the output", { skip: built, timeout: 120_000 }, () => {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  const r = spawnSync(process.execPath, [path.join(repo, "scripts/demo.mjs"), "--auto", "--scripted"], { env, encoding: "utf8", timeout: 100_000 });
  assert.equal(r.status, 0, r.stderr + r.stdout.slice(-600));
  assert.match(r.stdout, /RESULT: all 4 actions were controlled correctly/);
  for (const want of ["allowed by policy, ran", "DENIED by policy, never ran", "approved by you, then ran", "REJECTED by you, never ran"]) assert.ok(r.stdout.includes(want), want);
  assert.ok(!/demo_[A-Za-z0-9_-]{20,}|tend_sk_[A-Za-z0-9_-]{20,}/.test(r.stdout + r.stderr), "no admin token or agent key was printed");
});
