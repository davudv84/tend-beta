// Runs with `npm test`. The real gate, workspace and agent loop against the real authorization code, with the
// HTTP layer replaced by an in-process adapter that answers exactly as the routes do (status codes included).
// Everything here proves one thing: when Tend does not say yes, the simulated action does not happen.
import assert from "node:assert/strict";
import { test } from "node:test";
import { cancelAuthorization, claimToken, consumeAuthorization, requestAuthorization, TTL } from "../../src/server/authz.ts";
import { memoryDb } from "../../src/server/db.ts";
import { HttpError } from "../../src/server/http.ts";
import { decide, getAgent, inbox, ingestEvents, registerAgent, setPolicy } from "../../src/server/repo.ts";
import { runAgent, SCENARIOS, tendHttp } from "./agent.mjs";
import { scriptedModel } from "./e2e.mjs";
import { createGate } from "./gate.mjs";

const PAY = { tool: "send_payment", action: "execute", resource: "INV-1", detail: "EUR 5.00 to Test GmbH" };
const APPROVE_PAYMENTS = [{ tool: "send_payment", action: "execute", effect: "approve" }];
const ALLOW_PAYMENTS = [{ tool: "send_payment", action: "execute", effect: "allow" }];

/**
 * Mirrors the routes. Options: `down(path)` is a network failure, `status(path)` a server error, `skew(path)` moves the
 * clock Tend sees, `tamper(path, body)` changes what is sent, `override(path, body)` replaces the answer, `lose(path)`
 * runs the call for real and then loses the response.
 */
function localTend(db, agentId, o = {}) {
  const calls = [];
  const fn = async (path, body, headers = {}) => {
    calls.push(path);
    if (o.down?.(path)) throw new TypeError("fetch failed");
    if (o.status?.(path)) throw Object.assign(new Error(`Tend ${o.status(path)}`), { status: o.status(path), body: {} });
    if (o.override?.(path, body) !== undefined) return o.override(path, body);
    const agent = await getAgent(db, agentId);
    const now = Date.now() + (o.skew?.(path) ?? 0);
    const sent = o.tamper ? o.tamper(path, body) : body;
    let out;
    try {
      const m = path.match(/^\/api\/v1\/authorizations\/([^/]+)\/(token|consume|cancel)$/);
      if (path === "/api/v1/authorizations") {
        const { view } = await requestAuthorization(db, agent, sent, headers["Idempotency-Key"] ?? null, now);
        if (view.status === "denied") throw Object.assign(new Error("Tend 403"), { status: 403, body: view });
        out = view;
      } else if (m?.[2] === "token") out = (await claimToken(db, agent, m[1], now)).view;
      else if (m?.[2] === "consume") out = await consumeAuthorization(db, agent, m[1], sent, now);
      else if (m?.[2] === "cancel") out = await cancelAuthorization(db, agent, m[1], now);
      else if (path === "/api/v1/events") out = { agentId, results: await ingestEvents(db, agent, [sent]) };
      else if (path === "/api/v1/agent/inbox") out = { agentId, ...(await inbox(db, agent)) };
      else throw new Error(`unrouted ${path}`);
    } catch (e) {
      if (e instanceof HttpError) throw Object.assign(new Error(`Tend ${e.status} ${e.code}: ${e.message}`), { status: e.status, code: e.code, body: { error: e.code, message: e.message, ...e.extra } });
      throw e;
    }
    if (o.lose?.(path) && !o.lose.done) {
      o.lose.done = true;
      throw new TypeError("fetch failed");
    }
    return out;
  };
  fn.calls = calls;
  return fn;
}

async function setup(policy, options = {}, gateOptions = {}) {
  const db = await memoryDb();
  const { agent, apiKey } = await registerAgent(db, { name: "Lindenhof assistant", model: "scripted", provider: "Anthropic" });
  await setPolicy(db, agent.id, policy, "enforce");
  const tend = localTend(db, agent.id, options);
  const logs = [];
  const gate = createGate({ tend, pollMs: 5, retryMs: 0, retries: 1, approvalTimeoutMs: 2_000, log: (l) => logs.push(l), ...gateOptions });
  let ran = 0;
  const act = async () => ++ran;
  const report = (event) => tend("/api/v1/events", { type: "tool.called", data: event });
  return { db, agent, apiKey, tend, gate, logs, act, ran: () => ran, report, run: (req = PAY) => gate.run(req, act, report) };
}
const evs = async (db, type) => (await db.all("SELECT data FROM events WHERE type = ? ORDER BY seq", type)).map((r) => JSON.parse(r.data));
const row = (db) => db.get("SELECT * FROM authorizations ORDER BY created_at DESC LIMIT 1");
const operatorView = (db) => db.all("SELECT * FROM events").then((r) => JSON.stringify(r));

test("allowed by policy: the action runs once, after Tend consumed the authorization, and the call is recorded", async () => {
  const s = await setup(ALLOW_PAYMENTS);
  const out = await s.run();
  assert.deepEqual([out.executed, out.outcome, s.ran()], [true, "success", 1]);
  assert.equal((await row(s.db)).status, "consumed");
  assert.equal((await evs(s.db, "authorization.consumed")).length, 1);
  // Monitoring still sees it, linked to the authorization.
  const called = (await evs(s.db, "tool.called")).at(-1);
  assert.deepEqual([called.tool, called.outcome, called.authorizationId], ["send_payment", "success", out.authorizationId]);
  await s.db.close();
});

test("denied by policy, or no policy at all: nothing runs, no token is ever requested, and an alert is raised", async () => {
  for (const policy of [[], [{ tool: "send_payment", action: "execute", effect: "deny" }], "not a policy"]) {
    const s = await setup([]);
    if (policy.length || typeof policy === "string") await s.db.run("UPDATE agents SET policy = ?", typeof policy === "string" ? policy : JSON.stringify(policy));
    const out = await s.run();
    assert.deepEqual([out.executed, out.outcome, s.ran()], [false, "denied", 0]);
    assert.equal(s.tend.calls.some((p) => /token|consume/.test(p)), false);
    assert.equal((await row(s.db)).token_hash, null);
    assert.equal((await evs(s.db, "alert.raised")).some((a) => a.kind === "policy_violation"), true);
    await s.db.close();
  }
});

test("pending human approval: it waits, does nothing until approved, then runs exactly once", async () => {
  const seenWhileWaiting = [];
  let s;
  s = await setup(APPROVE_PAYMENTS, {}, { onPending: async (id) => { seenWhileWaiting.push(s.ran()); await new Promise((r) => setTimeout(r, 30)); seenWhileWaiting.push(s.ran()); await decide(s.db, id, "approved"); } });
  const out = await s.run();
  assert.deepEqual(seenWhileWaiting, [0, 0]);
  assert.deepEqual([out.executed, s.ran()], [true, 1]);
  assert.equal((await s.db.get("SELECT status FROM reviews ORDER BY id LIMIT 1")).status, "approved");
  await s.db.close();
});

test("a human rejection means the action never runs, and the rejected request can never be revived", async () => {
  let s;
  s = await setup(APPROVE_PAYMENTS, {}, { onPending: (id) => decide(s.db, id, "rejected") });
  const out = await s.run();
  assert.deepEqual([out.executed, out.outcome, s.ran()], [false, "rejected", 0]);
  assert.equal(s.tend.calls.some((p) => p.endsWith("/consume")), false);
  assert.equal((await row(s.db)).token_hash, null);
  await assert.rejects(() => decide(s.db, out.authorizationId, "approved"), (e) => e.code === "already_decided");
  await s.db.close();
});

test("nobody decides in time: the gate cancels, nothing runs, and a late approval is refused", async () => {
  const s = await setup(APPROVE_PAYMENTS, {}, { approvalTimeoutMs: 40 });
  const out = await s.run();
  assert.deepEqual([out.executed, out.outcome, s.ran()], [false, "timeout", 0]);
  assert.equal((await row(s.db)).status, "cancelled");
  await assert.rejects(() => decide(s.db, out.authorizationId, "approved"), (e) => e.code === "already_decided");
  await s.db.close();
});

test("expired: an unanswered request, an unused token and an unused approval all stop the action", async () => {
  // The request itself expires while it waits.
  let s = await setup(APPROVE_PAYMENTS, { skew: (p) => (p.endsWith("/token") ? TTL.request + 1_000 : 0) });
  let out = await s.run();
  assert.deepEqual([out.executed, out.outcome, s.ran(), (await row(s.db)).status], [false, "expired", 0, "expired"]);
  await assert.rejects(() => decide(s.db, out.authorizationId, "approved"), (e) => e.status === 409);
  await s.db.close();

  // The token expires before it is spent (the approval is still valid, but this attempt is over).
  s = await setup(ALLOW_PAYMENTS, { skew: (p) => (p.endsWith("/consume") ? TTL.token + 1_000 : 0) });
  out = await s.run();
  assert.deepEqual([out.executed, out.reason, s.ran()], [false, "token_expired", 0]);
  await s.db.close();

  // The approval itself runs out.
  s = await setup(ALLOW_PAYMENTS, { skew: (p) => (p.endsWith("/consume") ? TTL.approval + 1_000 : 0) });
  out = await s.run();
  assert.deepEqual([out.executed, s.ran(), (await row(s.db)).status], [false, 0, "expired"]);
  await s.db.close();
});

test("replay: a spent token cannot be used again, and running the same request again needs a fresh authorization", async () => {
  const spent = [];
  const s = await setup(ALLOW_PAYMENTS);
  const tend = s.tend;
  const gate = createGate({ tend: (p, b, h) => (p.endsWith("/consume") && spent.push({ path: p, body: b }), tend(p, b, h)), pollMs: 5, retryMs: 0 });
  assert.equal((await gate.run(PAY, s.act)).executed, true);
  assert.equal(s.ran(), 1);
  // An attacker who captured the token tries it again, directly.
  await assert.rejects(() => tend(spent[0].path, spent[0].body), (e) => e.status === 409 && e.code === "already_consumed");
  assert.equal(s.ran(), 1);
  assert.equal((await evs(s.db, "alert.raised")).some((a) => a.kind === "authorization_replay"), true);
  // A second run is a second, separate authorization.
  assert.equal((await gate.run(PAY, s.act)).executed, true);
  assert.deepEqual([s.ran(), (await s.db.get("SELECT COUNT(*)::int AS n FROM authorizations")).n], [2, 2]);
  await s.db.close();
});

test("mismatched execution: if the call differs from what was authorized, Tend refuses and nothing runs", async () => {
  const s = await setup(ALLOW_PAYMENTS, { tamper: (p, b) => (p.endsWith("/consume") ? { ...b, resource: "INV-2" } : b) });
  const out = await s.run();
  assert.deepEqual([out.executed, out.reason, s.ran()], [false, "mismatch", 0]);
  assert.equal((await evs(s.db, "alert.raised")).some((a) => a.kind === "authorization_mismatch"), true);
  await s.db.close();
});

test("fail closed: whenever Tend cannot be reached or answers badly, the action does not run", async () => {
  const cases = {
    "network down": { down: () => true },
    "server error on request": { status: (p) => (p === "/api/v1/authorizations" ? 503 : 0) },
    "network down when consuming": { down: (p) => p.endsWith("/consume") },
    "server error when consuming": { status: (p) => (p.endsWith("/consume") ? 500 : 0) },
    "empty answer to the request": { override: (p) => (p === "/api/v1/authorizations" ? {} : undefined) },
    "request answered as already approved but with no id": { override: (p) => (p === "/api/v1/authorizations" ? { status: "approved" } : undefined) },
    "approved with no token": { override: (p) => (p.endsWith("/token") ? { status: "approved" } : undefined) },
    "consume says no": { override: (p) => (p.endsWith("/consume") ? { authorized: false } : undefined) },
    "consume answers for a different tool": { override: (p, b) => (p.endsWith("/consume") ? { authorized: true, authorizationId: p.split("/")[4], ...b, tool: "send_refund" } : undefined) },
    "consume answers for a different amount": { override: (p, b) => (p.endsWith("/consume") ? { authorized: true, authorizationId: p.split("/")[4], ...b, detail: "EUR 9000.00 to Someone Else" } : undefined) },
    "consume answers without an authorization id": { override: (p, b) => (p.endsWith("/consume") ? { authorized: true, ...b } : undefined) },
  };
  for (const [name, options] of Object.entries(cases)) {
    const s = await setup(ALLOW_PAYMENTS, options, { approvalTimeoutMs: 30 });
    const out = await s.run();
    assert.deepEqual([out.executed, s.ran()], [false, 0], name);
    await s.db.close();
  }
});

test("a lost consume response is never retried: the authorization is spent, the action does not run", async () => {
  const lose = (p) => p.endsWith("/consume");
  const s = await setup(ALLOW_PAYMENTS, { lose });
  const out = await s.run();
  assert.deepEqual([out.executed, out.outcome, s.ran()], [false, "unavailable", 0]);
  assert.equal(s.tend.calls.filter((p) => p.endsWith("/consume")).length, 1);
  assert.equal((await row(s.db)).status, "consumed");
  await s.db.close();
});

test("a lost response to the request is retried safely: one authorization, one execution", async () => {
  const lose = (p) => p === "/api/v1/authorizations";
  const s = await setup(ALLOW_PAYMENTS, { lose });
  const out = await s.run();
  assert.deepEqual([out.executed, s.ran(), (await s.db.get("SELECT COUNT(*)::int AS n FROM authorizations")).n], [true, 1, 1]);
  await s.db.close();
});

test("a paused agent cannot act even with an approved authorization in hand", async () => {
  const s = await setup(ALLOW_PAYMENTS, {}, { approvalTimeoutMs: 30 });
  await s.db.run("UPDATE agents SET status = 'paused' WHERE id = ?", s.agent.id);
  const out = await s.run();
  assert.deepEqual([out.executed, s.ran()], [false, 0]);
  await s.db.close();
});

test("tokens and keys never appear in logs, results, stored events or error text", async () => {
  const captured = [];
  const s = await setup(APPROVE_PAYMENTS, {}, { onPending: (id) => decide(s.db, id, "approved") });
  const tend = async (p, b, h) => {
    try {
      const r = await s.tend(p, b, h);
      if (r?.token) captured.push(r.token);
      return r;
    } catch (e) {
      captured.push(String(e.message), JSON.stringify(e.body ?? {}));
      throw e;
    }
  };
  const logs = [];
  const gate = createGate({ tend, pollMs: 5, retryMs: 0, onPending: (id) => decide(s.db, id, "approved"), log: (l) => logs.push(l) });
  const out = await gate.run(PAY, s.act, (event) => tend("/api/v1/events", { type: "tool.called", data: event }));
  const token = captured.find((x) => x.startsWith("tend_az_"));
  assert.ok(token);
  const everything = JSON.stringify([logs, out, await operatorView(s.db), await s.db.all("SELECT * FROM authorizations")]) + captured.filter((x) => x !== token).join("");
  assert.equal(everything.includes(token), false);
  assert.equal(everything.includes(s.apiKey), false);
  assert.equal(/tend_az_|tend_sk_/.test(everything), false);
  await s.db.close();
});

test("tendHttp: errors keep status and code but never the key or request body; a hang or outage has no status", async () => {
  const real = globalThis.fetch;
  const key = "tend_sk_secretsecretsecret";
  try {
    globalThis.fetch = async () => Response.json({ error: "not_approved", message: "nope", status: "rejected" }, { status: 403 });
    const e = await tendHttp("http://tend.test", key)("/x", { token: "tend_az_SECRET" }).catch((x) => x);
    assert.deepEqual([e.status, e.code, e.body.status], [403, "not_approved", "rejected"]);
    assert.equal(JSON.stringify({ m: e.message, b: e.body, s: e.stack?.split("\n")[0] }).match(/tend_sk_|tend_az_/), null);

    globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
    assert.equal((await tendHttp("http://tend.test", key)("/x").catch((x) => x)).status, undefined);

    globalThis.fetch = (_url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
    assert.equal((await tendHttp("http://tend.test", key, { timeoutMs: 20 })("/x").catch((x) => x)).status, undefined);
  } finally {
    globalThis.fetch = real;
  }
});

test("Tend decides: an agent set to enforce uses the gate without being told to, and one in monitor mode keeps the old approval flow", async () => {
  const policy = [{ tool: "send_payment", action: "execute", effect: "approve" }];
  for (const mode of ["enforce", "monitor"]) {
    const db = await memoryDb();
    const { agent } = await registerAgent(db, { name: "Lindenhof assistant", model: "scripted", provider: "Anthropic" });
    await setPolicy(db, agent.id, policy, mode);
    const held = [];
    const { report, workspace } = await runAgent({
      model: scriptedModel(), tend: localTend(db, agent.id), pollMs: 5, approvalTimeoutMs: 2_000,
      scenarios: SCENARIOS.filter((s) => s.id === "payment"), onPending: (id) => (held.push(id), decide(db, id, "approved")),
    });
    const calls = report[0].calls;
    if (mode === "enforce") {
      // Held as an authorization, paid once with the token Tend issued, and recorded without any alert.
      assert.match(held[0], /^az_/);
      assert.deepEqual(calls.map((c) => [c.outcome, c.authorizationId, c.alerts]), [["success", held[0], []]]);
      assert.equal(workspace.payments[0].authorizationId, held[0]);
      assert.equal((await row(db)).status, "consumed");
    } else {
      assert.deepEqual(calls.map((c) => c.outcome), ["pending_approval", "success"]);
      assert.equal(await db.get("SELECT 1 FROM authorizations"), undefined);
    }
    await db.close();
  }
});

test("the whole agent, enforced: restricted reads are denied, payments need a human, and rejected ones are never paid", async () => {
  const policy = [
    { tool: "read_document", action: "read", resourcePrefix: "DOC-R-", effect: "deny" },
    { tool: "send_payment", action: "execute", effect: "approve" },
  ];
  for (const decision of ["approved", "rejected"]) {
    const db = await memoryDb();
    const { agent } = await registerAgent(db, { name: "Lindenhof assistant", model: "scripted", provider: "Anthropic" });
    await setPolicy(db, agent.id, policy, "enforce");
    const seen = [];
    const { report, workspace } = await runAgent({
      model: scriptedModel(seen), tend: localTend(db, agent.id), enforce: true, pollMs: 5, approvalTimeoutMs: 2_000,
      scenarios: SCENARIOS.filter((s) => ["normal", "restricted", "payment"].includes(s.id)), onPending: (id) => decide(db, id, decision),
    });
    const by = Object.fromEntries(report.map((r) => [r.id, r]));
    // Unprotected work is untouched; the restricted read never happened; the model never saw the text.
    assert.deepEqual(by.normal.calls.map((c) => c.outcome), ["success", "success"]);
    assert.deepEqual(by.restricted.calls.map((c) => [c.outcome, c.policy]), [["denied", "policy_denied"]]);
    assert.deepEqual(by.restricted.calls.flatMap((c) => c.alerts), ["policy_violation"]);
    assert.equal(JSON.stringify(seen).includes("49k"), false);
    if (decision === "approved") {
      assert.deepEqual(workspace.payments.map((p) => p.invoice), ["INV-2041"]);
      assert.deepEqual(by.payment.calls.map((c) => c.outcome), ["success"]);
      assert.equal(by.payment.calls[0].authorizationId, workspace.payments[0].authorizationId);
    } else {
      assert.deepEqual(workspace.payments, []);
      assert.deepEqual(by.payment.calls.map((c) => c.outcome), ["denied"]);
    }
    // History is intact: the task lifecycle and tool events are all still recorded.
    assert.equal((await evs(db, "task.completed")).length, 3);
    assert.equal((await evs(db, "tool.called")).length, 4);
    await db.close();
  }
});
