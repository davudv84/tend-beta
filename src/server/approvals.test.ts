// resolveApproval, against a real (in-memory) database and the real authorization flow: the one decision every channel shares.
// Approve, deny, a second decision, simultaneous decisions, expiry, another workspace, and high risk from a notification.
import assert from "node:assert/strict";
import { test } from "node:test";
import { getApproval, listPendingApprovals, resolveApproval, type Actor } from "./approvals.ts";
import { authorizationStatus, requestAuthorization, spendApproved, TTL } from "./authz.ts";
import { memoryDb, type DB } from "./db.ts";
import { applyChoices } from "../lib/permissions.ts";
import { parsePolicy } from "./policy.ts";
import { createCentralPolicy, assignCentralPolicy, decide, getAgent, registerAgent, setPolicy } from "./repo.ts";

process.env.TEND_DEMO = "0";

const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
const EMAIL = { tool: "send_email", action: "send", resource: "client-1042", detail: "Email to client 1042, subject: Invoice 42" };
const NOTE = { tool: "read_ticket", action: "read", resource: "ticket-7", detail: "Read ticket 7" };
/** One rule that asks at the default (high) risk, one a person marked low. */
const RULES = [{ tool: "send_email", action: "send", effect: "approve" }, { tool: "read_ticket", action: "read", effect: "approve", risk: "low" }];

async function world(rules: unknown[] = RULES) {
  const db = await memoryDb();
  for (const n of [1, 2]) {
    await db.run("INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, 0)", `w${n}`, `W${n}`);
    await db.run("INSERT INTO users (id, email, password_hash, workspace_id, created_at, email_verified_at, approved_at, password_changed_at) VALUES (?, ?, 'x', ?, 0, 0, 0, 0)", `u${n}`, `u${n}@example.com`, `w${n}`);
  }
  const { agent: registered } = await registerAgent(db, { name: "Probe", model: "test", provider: "Custom" }, "s", "w1");
  await setPolicy(db, registered.id, rules, "enforce");
  const agent = (await getAgent(db, registered.id))!;
  const ana: Actor = { workspace: "w1", userId: "u1", by: "s1" };
  const ben: Actor = { workspace: "w2", userId: "u2", by: "s2" };
  const ask = async (body: object = EMAIL, now?: number) => (await requestAuthorization(db, agent, body, null, now)).view.id;
  return { db, agent, ana, ben, ask };
}
const decisions = async (db: DB) => (await db.all<{ data: string }>("SELECT data FROM events WHERE type = 'review.decided' ORDER BY seq")).map((e) => JSON.parse(e.data));

test("approve: the approval is approved, the agent's own flow goes on unchanged, and the decision is in the audit log with who, channel and id", async () => {
  const { db, agent, ana, ask } = await world();
  const id = await ask();
  assert.deepEqual((await listPendingApprovals(db, "w1")).map((a) => [a.id, a.status, a.risk, a.agentName, a.url]), [[id, "pending", "high", "Probe", `/approvals/${id}`]]);
  const t = Date.now();
  const r = await resolveApproval(db, { id, decision: "approve", via: "dashboard", actor: ana }, t);
  assert.equal(r.changed, true);
  assert.deepEqual({ status: r.approval.status, decision: r.approval.decision, by: r.approval.decidedBy, via: r.approval.via, at: r.approval.decidedAt }, { status: "approved", decision: "approve", by: "u1@example.com", via: "dashboard", at: t });
  assert.deepEqual(await listPendingApprovals(db, "w1"), []);
  // The agent sees what it always saw, and spends the approval exactly as before.
  assert.equal((await authorizationStatus(db, agent, id)).status, "approved");
  assert.equal((await spendApproved(db, agent, id, EMAIL)).authorized, true);
  assert.equal((await getApproval(db, "w1", id)).status, "approved", "used by the agent, it is still an approved approval");
  const [d, ...more] = await decisions(db);
  assert.equal(more.length, 0);
  assert.deepEqual({ reviewId: d.reviewId, authorizationId: d.authorizationId, status: d.status, by: d.by, userId: d.userId, via: d.via }, { reviewId: id, authorizationId: id, status: "approved", by: "s1", userId: "u1", via: "dashboard" });
  const at = (await db.get<{ at: number }>("SELECT at FROM events WHERE type = 'review.decided'"))!.at;
  assert.equal(at, t, "when");
  await db.close();
});

test("deny: the approval is denied and the agent cannot act on it", async () => {
  const { db, agent, ana, ask } = await world();
  const id = await ask();
  const r = await resolveApproval(db, { id, decision: "deny", via: "dashboard", actor: ana });
  assert.deepEqual({ changed: r.changed, status: r.approval.status, decision: r.approval.decision }, { changed: true, status: "denied", decision: "deny" });
  assert.equal((await authorizationStatus(db, agent, id)).status, "rejected");
  assert.equal(await code(spendApproved(db, agent, id, EMAIL)), "not_approved");
  assert.deepEqual((await decisions(db)).map((d) => [d.status, d.via]), [["rejected", "dashboard"]]);
  await db.close();
});

test("a second decision changes nothing and returns the first result, whatever it asks for and whichever channel it comes through", async () => {
  const { db, agent, ana, ask } = await world();
  const id = await ask(NOTE);
  const first = await resolveApproval(db, { id, decision: "deny", via: "telegram", actor: { ...ana, by: "telegram:77" } });
  assert.equal(first.changed, true);
  for (const via of ["dashboard", "web-push", "telegram"] as const) {
    const again = await resolveApproval(db, { id, decision: "approve", via, actor: ana });
    assert.equal(again.changed, false);
    assert.deepEqual(again.events, []);
    assert.deepEqual(again.approval, first.approval, "the same answer as the first time");
  }
  assert.equal((await authorizationStatus(db, agent, id)).status, "rejected", "the later approvals did not turn the denial around");
  assert.deepEqual((await decisions(db)).map((d) => [d.status, d.via, d.by]), [["rejected", "telegram", "telegram:77"]], "one decision in the log");
  await db.close();
});

test("simultaneous decisions: exactly one wins, every caller gets that one result, and one decision is recorded", async () => {
  const { db, agent, ana, ask } = await world();
  const id = await ask(NOTE);
  const taps = ["approve", "deny", "approve", "deny", "approve", "deny"] as const;
  const results = await Promise.all(taps.map((decision, i) => resolveApproval(db, { id, decision, via: i % 2 ? "web-push" : "telegram", actor: ana })));
  assert.equal(results.filter((r) => r.changed).length, 1, "one winner");
  const winner = results.find((r) => r.changed)!;
  for (const r of results) assert.deepEqual(r.approval, winner.approval);
  assert.equal((await decisions(db)).length, 1);
  assert.equal((await authorizationStatus(db, agent, id)).status, winner.approval.status === "approved" ? "approved" : "rejected");
  await db.close();
});

test("expired means denied: a decision that arrives too late changes nothing, and the agent is told it expired when it checks", async () => {
  const { db, agent, ana, ask } = await world();
  const t0 = Date.now();
  assert.equal(TTL.request, 10 * 60_000, "ten minutes unless configured");
  const late = await ask(EMAIL, t0), unread = await ask(NOTE, t0);
  assert.equal((await getApproval(db, "w1", late, t0)).expiresAt, t0 + TTL.request);
  // A decision one moment before the deadline still counts; here it arrives one moment after.
  const r = await resolveApproval(db, { id: late, decision: "approve", via: "dashboard", actor: ana }, t0 + TTL.request + 1);
  assert.deepEqual({ changed: r.changed, status: r.approval.status, decision: r.approval.decision, by: r.approval.decidedBy }, { changed: false, status: "expired", decision: "deny", by: null });
  assert.equal(await code(spendApproved(db, agent, late, EMAIL, t0 + TTL.request + 2)), "not_approved");
  assert.deepEqual(await decisions(db), [], "no decision was recorded");
  // Nobody touched the other one: the agent asking for its status is what finds it expired.
  const other = await memoryless(db, unread);
  assert.equal(other, "expired");
  assert.equal((await authorizationStatus(db, agent, unread, t0 + TTL.request + 1)).status, "expired");
  assert.equal((await getApproval(db, "w1", unread, t0 + TTL.request + 1)).decision, "deny");
  assert.deepEqual(await listPendingApprovals(db, "w1", t0 + TTL.request + 1), []);
  await db.close();

  /** The stored status after the first late decision swept everything past its time. */
  async function memoryless(q: DB, id: string) { return (await q.get<{ status: string }>("SELECT status FROM authorizations WHERE id = ?", id))!.status; }
});

test("the waiting time is configurable (TEND_APPROVAL_TTL_MINUTES)", async () => {
  process.env.TEND_APPROVAL_TTL_MINUTES = "2";
  try {
    const { db, ana, ask } = await world();
    const t0 = Date.now(), id = await ask(EMAIL, t0);
    assert.equal((await getApproval(db, "w1", id, t0)).expiresAt, t0 + 2 * 60_000);
    assert.equal((await resolveApproval(db, { id, decision: "approve", via: "dashboard", actor: ana }, t0 + 2 * 60_000 + 1)).approval.status, "expired");
    await db.close();
  } finally {
    delete process.env.TEND_APPROVAL_TTL_MINUTES;
  }
});

test("another workspace cannot see or decide an approval: it does not exist for them, and an account outside the workspace is refused", async () => {
  const { db, agent, ana, ben, ask } = await world();
  const id = await ask(NOTE);
  assert.deepEqual(await listPendingApprovals(db, "w2"), []);
  assert.equal(await code(getApproval(db, "w2", id)), "approval_not_found");
  for (const via of ["dashboard", "web-push", "telegram"] as const) for (const decision of ["approve", "deny"] as const)
    assert.equal(await code(resolveApproval(db, { id, decision, via, actor: ben })), "approval_not_found");
  assert.equal(await code(resolveApproval(db, { id: "az_000000000000000000000000", decision: "approve", via: "dashboard", actor: ana })), "approval_not_found", "the same answer as for an id nobody has");
  // A caller that names the right workspace but an account from elsewhere, a disabled account, and a read-only one.
  assert.equal(await code(resolveApproval(db, { id, decision: "approve", via: "dashboard", actor: { workspace: "w1", userId: "u2", by: "s2" } })), "not_a_member");
  await db.run("UPDATE users SET disabled_at = 1 WHERE id = 'u1'");
  assert.equal(await code(resolveApproval(db, { id, decision: "approve", via: "dashboard", actor: ana })), "not_a_member");
  await db.run("UPDATE users SET disabled_at = NULL, read_only = 1 WHERE id = 'u1'");
  assert.equal(await code(resolveApproval(db, { id, decision: "deny", via: "dashboard", actor: ana })), "not_a_member");
  assert.equal((await authorizationStatus(db, agent, id)).status, "pending", "nothing above decided anything");
  assert.deepEqual(await decisions(db), []);
  await db.close();
});

test("high risk: approving from a notification (web push, Telegram) is refused; it is confirmed in the dashboard. Denying is allowed from anywhere", async () => {
  const { db, agent, ana, ask } = await world();
  const id = await ask(EMAIL);
  assert.equal((await getApproval(db, "w1", id)).risk, "high", "no rule said otherwise");
  for (const via of ["web-push", "telegram"] as const) {
    const e = await resolveApproval(db, { id, decision: "approve", via, actor: ana }).catch((x) => x);
    assert.deepEqual({ code: e.code, status: e.status, url: e.extra?.url }, { code: "confirmation_required", status: 403, url: `/approvals/${id}` });
  }
  assert.equal((await authorizationStatus(db, agent, id)).status, "pending", "still waiting");
  assert.deepEqual(await decisions(db), []);
  assert.equal((await resolveApproval(db, { id, decision: "approve", via: "dashboard", actor: ana })).approval.status, "approved");
  // A second high-risk one, denied with one tap: saying no never needs a second look.
  const other = await ask({ ...EMAIL, resource: "client-7" });
  assert.equal((await resolveApproval(db, { id: other, decision: "deny", via: "web-push", actor: ana })).approval.status, "denied");
  await db.close();
});

test("low risk comes only from a rule that says so: such an approval can be approved with one tap from a notification", async () => {
  const { db, ana, ask } = await world();
  for (const via of ["web-push", "telegram"] as const) {
    const id = await ask({ ...NOTE, resource: `ticket-${via}` });
    assert.equal((await getApproval(db, "w1", id)).risk, "low");
    const r = await resolveApproval(db, { id, decision: "approve", via, actor: ana });
    assert.deepEqual({ changed: r.changed, status: r.approval.status, via: r.approval.via }, { changed: true, status: "approved", via });
  }
  assert.deepEqual((await decisions(db)).map((d) => d.via), ["web-push", "telegram"]);
  await db.close();
});

test("risk is the server's: a tool that spends money can never be low, and an agent's own rule cannot lower what a central policy holds high", async () => {
  // Marking a spending tool low is refused when the policy is saved, and its rule is otherwise valid.
  assert.equal(parsePolicy([{ tool: "pay_invoice", action: "pay", effect: "approve", risk: "low" }]).ok, true);
  const { db, agent, ask } = await world();
  assert.equal(await code(setPolicy(db, agent.id, [{ tool: "pay_invoice", action: "pay", effect: "approve", risk: "low" }], "enforce")), "spend_requires_approval");
  assert.equal(parsePolicy([{ tool: "x", action: "y", effect: "approve", risk: "medium" }]).ok, false, "low or high, nothing else");
  // The agent's own rule says low; the central policy governs the same tool at the default (high).
  const central = await createCentralPolicy(db, { name: "Baseline", rules: [{ tool: "read_ticket", action: "read", effect: "approve" }] }, "s", "w1");
  await assignCentralPolicy(db, central.id, { assign: [agent.id] }, "s");
  assert.equal((await getApproval(db, "w1", await ask(NOTE))).risk, "high");
  await db.close();
});

test("anything but approve/deny and a known channel is refused before anything is read", async () => {
  const { db, ana, ask } = await world();
  const id = await ask();
  assert.equal(await code(resolveApproval(db, { id, decision: "approved", via: "dashboard", actor: ana })), "invalid_decision");
  assert.equal(await code(resolveApproval(db, { id, decision: "approve", via: "sms", actor: ana })), "invalid_via");
  assert.equal(await code(resolveApproval(db, { id: "az_'; DROP TABLE users; --", decision: "approve", via: "dashboard", actor: ana })), "approval_not_found");
  await db.close();
});

test("the dashboard's older route (decide) and resolveApproval agree: either one decides, the other then finds it decided", async () => {
  const { db, ana, ask } = await world();
  const a = await ask(), b = await ask(NOTE);
  await decide(db, a, "approved", undefined, "s1");
  const r = await resolveApproval(db, { id: a, decision: "deny", via: "web-push", actor: ana });
  assert.deepEqual({ changed: r.changed, status: r.approval.status, via: r.approval.via, by: r.approval.decidedBy }, { changed: false, status: "approved", via: "dashboard", by: "admin" });
  await resolveApproval(db, { id: b, decision: "deny", via: "telegram", actor: ana });
  assert.equal(await code(decide(db, b, "approved", undefined, "s1")), "already_decided");
  await db.close();
});

test("the Permissions screen keeps a rule's risk while the tool still asks, and drops it when the tool no longer does", () => {
  const saved = [{ tool: "read_ticket", action: "read", effect: "approve" as const, risk: "low" as const }, { tool: "send_email", action: "send", effect: "approve" as const }];
  assert.deepEqual(applyChoices(saved, [{ tool: "read_ticket", action: "read", choice: "ask" }]).find((r) => r.tool === "read_ticket"), { tool: "read_ticket", action: "read", effect: "approve", risk: "low" });
  assert.deepEqual(applyChoices(saved, [{ tool: "read_ticket", action: "read", choice: "allow" }]).find((r) => r.tool === "read_ticket"), { tool: "read_ticket", action: "read", effect: "allow" });
  assert.deepEqual(applyChoices(saved, [{ tool: "send_email", action: "send", choice: "ask" }]).find((r) => r.tool === "send_email"), { tool: "send_email", action: "send", effect: "approve" }, "nothing becomes low by itself");
});
