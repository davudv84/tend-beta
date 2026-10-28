// Runs with `npm test`. The real agent loop and workspace against an in-memory Tend, with a scripted
// stand-in for Claude, so every scenario is checked without API calls or cost.
import assert from "node:assert/strict";
import { test } from "node:test";
import { memoryDb } from "../../src/server/db.ts";
import { decide, getAgent, inbox, ingestEvents, registerAgent } from "../../src/server/repo.ts";
import { snapshot } from "../../src/server/sync.ts";
import { applyEvents, emptyProjection } from "../../src/lib/projection.ts";
import { costOf, runAgent, SCENARIOS } from "./agent.mjs";
import { expectedAlerts, scriptedModel } from "./e2e.mjs";
import { createWorkspace } from "./workspace.mjs";

async function setup() {
  const db = await memoryDb();
  const { agent } = await registerAgent(db, { name: "Lindenhof assistant", model: "scripted", provider: "Anthropic" });
  const tend = async (path, body) => {
    const a = await getAgent(db, agent.id);
    if (path === "/api/v1/agent/inbox") return { agentId: a.id, ...(await inbox(db, a)) };
    if (path === "/api/v1/events") return { agentId: a.id, results: await ingestEvents(db, a, [body]) };
    throw new Error(path);
  };
  return { db, agent, tend };
}

test("all five scenarios are recorded and detected correctly, and nothing sensitive reaches Tend", async () => {
  const { db, agent, tend } = await setup();
  const seen = [];
  const { report, workspace } = await runAgent({ model: scriptedModel(seen), tend, pollMs: 5, onPending: (id) => decide(db, id, "approved") });
  const by = Object.fromEntries(report.map((r) => [r.id, r]));
  const outcomes = (id) => by[id].calls.map((c) => `${c.tool}.${c.action}:${c.outcome}`);
  const alerts = (id) => by[id].calls.flatMap((c) => c.alerts);

  assert.deepEqual(outcomes("normal"), ["read_document.read:success", "create_task.create:success"]);
  assert.deepEqual(alerts("normal"), []);
  assert.deepEqual(outcomes("failure"), ["read_document.read:failure"]);
  assert.deepEqual(alerts("failure"), []);
  assert.deepEqual(outcomes("restricted"), ["read_document.read:denied"]);
  assert.deepEqual(alerts("restricted"), ["policy_violation"]);
  assert.deepEqual(outcomes("payment"), ["send_payment.create:pending_approval", "send_payment.execute:success"]);
  assert.deepEqual(alerts("payment"), []);
  assert.deepEqual(outcomes("repeated"), Array(3).fill("create_task.create:failure"));
  assert.deepEqual(by.repeated.calls.map((c) => c.alerts), [[], [], ["repeated_failures"]]);
  // The e2e script's independent expectation agrees with what Tend raised.
  assert.deepEqual(expectedAlerts(report), report.map((r) => r.calls.flatMap((c) => c.alerts)));

  // It confirmed its configuration, so Tend shows it as applied, not pending.
  const after = await getAgent(db, agent.id);
  assert.equal(after.ackedVersion, after.configVersion);
  assert.deepEqual(report.map((r) => r.calls.length), [2, 1, 1, 2, 3]);

  // The tool really denied it: the model never saw the restricted text, and only the approved payment was made.
  assert.equal(JSON.stringify(seen).includes("49k"), false);
  assert.deepEqual(workspace.payments.map((p) => p.invoice), ["INV-2041"]);

  // Tend stored identifiers only: no document text, no prompt, no model output.
  const stored = JSON.stringify(await db.all("SELECT data FROM events"));
  for (const secret of ["49k", "30 days per year", SCENARIOS[2].prompt, "Done."]) assert.equal(stored.includes(secret), false, secret);

  // What the interface reads: tool events in the Study and timeline, alerts in the log, the payment in the review queue.
  const p = (await snapshot(db, { role: "operator", canAct: true, public: true, operatorAvailable: true, demo: false })).projection;
  assert.equal(p.taskEvents.filter((t) => t.type === "tool.called").length, 9);
  // A finished task keeps its own title, not the title of its last tool call.
  assert.deepEqual(p.taskEvents.filter((t) => t.agentId === agent.id && t.type === "task.completed").map((t) => t.title).reverse(), SCENARIOS.map((s) => s.title));
  assert.deepEqual(p.taskEvents.filter((t) => t.agentId === agent.id && t.type === "task.completed").map((t) => t.summary).reverse(), ["2 tool calls", "1 tool call", "1 tool call", "2 tool calls", "3 tool calls"]);
  assert.deepEqual(p.log.filter((l) => l.actor === "system").map((l) => l.type).reverse(), ["policy_violation", "repeated_failures"]);
  // Each alert names what was affected and points at the tool call behind it, which the Study can open.
  const flagged = p.log.filter((l) => l.agentId === agent.id && ["policy_violation", "repeated_failures"].includes(l.type)).reverse();
  assert.deepEqual(flagged.map((l) => l.note), ["DOC-R-201 · denied", "WAREHOUSE · 3 failures"]);
  assert.deepEqual(flagged.map((l) => p.taskEvents.find((t) => t.id === l.eventId)?.title), ["read_document · read · DOC-R-201", "create_task · create · WAREHOUSE"]);
  // Marked as a held action, so the review queue offers Approve and Reject, not only "Mark reviewed".
  assert.deepEqual(p.requests.map((r) => [r.review.status, r.approval]), [["approved", true]]);
  await db.close();
});

test("a rejected or unanswered payment is never executed", async () => {
  // After a timeout the review is withdrawn: it leaves the queue and a late approval is refused.
  for (const [decision, expected, final] of [[(db, id) => decide(db, id, "rejected"), "rejected", "rejected"], [() => {}, "timeout", "withdrawn"]]) {
    const { db, agent, tend } = await setup();
    const { report, workspace } = await runAgent({ model: scriptedModel([]), tend, scenarios: SCENARIOS.filter((s) => s.id === "payment"), pollMs: 5, approvalTimeoutMs: 50, onPending: (id) => decision(db, id) });
    assert.deepEqual(report[0].calls.map((c) => c.outcome), ["pending_approval", "cancelled"]);
    assert.deepEqual(workspace.payments, [], expected);
    const reviewId = report[0].calls[0].eventId;
    const p = (await snapshot(db, { role: "operator", canAct: true, public: true, operatorAvailable: true, demo: false })).projection;
    assert.deepEqual(p.requests.filter((r) => r.agentId === agent.id).map((r) => r.review.status), [final], expected);
    await assert.rejects(() => decide(db, reviewId, "approved"), (e) => e.code === "already_decided");
    if (final === "withdrawn") assert.equal(p.log.find((l) => l.agentId === agent.id && l.type === "review_withdrawn")?.actor, "system");
    await db.close();
  }
});

test("the workspace enforces its rules without Tend", async () => {
  const events = [];
  const ctx = { report: async (e) => events.push(e), requestApproval: async () => ({ status: "approved", approvalId: "r1" }) };
  const granted = createWorkspace({ permissions: ["docs.restricted.read"] });
  assert.equal((await granted.run("read_document", { id: "DOC-R-201" }, ctx)).id, "DOC-R-201");
  const plain = createWorkspace();
  assert.match((await plain.run("read_document", { id: "DOC-R-201" }, ctx)).error, /denied/);
  assert.match((await plain.run("send_payment", { payee: "x", amount_eur: 50_000, invoice: "I" }, ctx)).error, /between/);
  assert.match((await plain.run("rm -rf", {}, ctx)).error, /Unknown/);
  assert.deepEqual(events.map((e) => [e.tool, e.outcome]), [["read_document", "success"], ["read_document", "denied"], ["send_payment", "failure"], ["rm-rf", "failure"]]);
  assert.equal(plain.payments.length, 0);
  // 1,000 input + 200 output tokens on Haiku 4.5: $0.001 + $0.001.
  assert.equal(costOf({ input_tokens: 1000, output_tokens: 200 }), 0.002);
});

test("alerts recorded before resources were stored still show one, taken from the call they point to", () => {
  const call = { seq: 1, id: "ev_call", agentId: "a", type: "tool.called", at: 1, actor: "agent", data: { tool: "read_document", action: "read", outcome: "denied", resource: "DOC-R-201", policy: "restricted_document" } };
  const alert = { seq: 2, id: "ev_alert", agentId: "a", type: "alert.raised", at: 2, actor: "system", data: { kind: "policy_violation", eventId: "ev_call", tool: "read_document", action: "read", policy: "restricted_document", blocked: true } };
  // Applied together, and in separate batches as the browser does.
  for (const p of [applyEvents(emptyProjection(), [call, alert]), applyEvents(applyEvents(emptyProjection(), [call]), [alert])])
    assert.deepEqual([p.log[0].note, p.log[0].eventId], ["DOC-R-201 · denied", "ev_call"]);
});
