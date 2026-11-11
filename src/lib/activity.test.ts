import assert from "node:assert/strict";
import { test } from "node:test";
import type { TimelineEvent } from "./derive.ts";
import { byAction, decidingStep, inGroup, outcomeOf, trailOf, visibleAgent } from "./activity.ts";

const log = (type: string, args?: Record<string, unknown>): TimelineEvent => ({ id: type, at: 1, agentId: "a", kind: "authorization", actor: "system", say: { k: "log", type, args } as never });
const tool = (outcome?: string): TimelineEvent => ({ id: "t", at: 1, agentId: "a", kind: "task", actor: "agent", outcome, say: { k: "task", type: "tool.called", title: "x" } });

test("every row's outcome word comes from what was recorded for that event", () => {
  assert.equal(outcomeOf(log("authorization_requested", { reason: "approval_required" })), "needs_approval");
  assert.equal(outcomeOf(log("authorization_requested", { reason: "policy_allowed" })), "allowed");
  assert.equal(outcomeOf(log("authorization_requested")), null, "no stated reason, no outcome: nothing is guessed");
  assert.equal(outcomeOf(log("authorization_approved")), "approved");
  assert.equal(outcomeOf(log("authorization_rejected")), "rejected");
  assert.equal(outcomeOf(log("authorization_denied", { reason: "agent_paused" })), "blocked");
  assert.equal(outcomeOf(log("authorization_consumed")), "ran");
  assert.equal(outcomeOf(log("authorization_expired")), "expired");
  for (const t of ["authorization_replay", "authorization_mismatch", "unauthorized_execution", "policy_violation"]) assert.equal(outcomeOf(log(t)), "alert", t);
  for (const t of ["agent_paused", "agent_resumed", "integration_disabled", "key_rotated", "agent_registered"]) assert.equal(outcomeOf(log(t)), "change", t);
  assert.equal(outcomeOf(tool("success")), "ran");
  assert.equal(outcomeOf(tool("denied")), "blocked");
  assert.equal(outcomeOf(tool("pending_approval")), "needs_approval");
  assert.equal(outcomeOf(tool()), null);
});

test("the groups are built from outcomes, and an event with no outcome is only in All", () => {
  assert.ok(inGroup(log("authorization_approved"), "approvals") && !inGroup(log("authorization_approved"), "blocked"));
  assert.ok(inGroup(log("authorization_denied"), "blocked") && inGroup(log("authorization_rejected"), "blocked"));
  assert.ok(inGroup(tool("success"), "allowed"));
  assert.ok(inGroup(log("authorization_replay"), "alerts"));
  assert.ok(inGroup(log("agent_paused"), "changes"));
  assert.ok(inGroup(tool(), "all") && !["approvals", "allowed", "blocked", "alerts", "changes"].some((g) => inGroup(tool(), g as never)));
});

test("sample assistants are left out unless asked for", () => {
  const agents = [{ id: "real", origin: "connected" as const }, { id: "demo", origin: "demo" as const }];
  assert.equal(visibleAgent(agents, false)({ agentId: "demo" }), false);
  assert.equal(visibleAgent(agents, false)({ agentId: "real" }), true);
  assert.equal(visibleAgent(agents, true)({ agentId: "demo" }), true);
});

test("one action is one row: its steps fold into the newest, events without an authorization stay apart", () => {
  const step = (id: string, at: number, ev: TimelineEvent, authorizationId?: string): TimelineEvent => ({ ...ev, id, at, ...(authorizationId && { authorizationId }) });
  const events = [
    step("rep", 5, tool("success"), "az1"),
    step("ran", 4, log("authorization_consumed"), "az1"),
    step("other", 3, log("agent_paused")),
    step("ok", 2, log("authorization_approved"), "az1"),
    step("ask", 1, log("authorization_requested", { reason: "approval_required", rule: { tool: "shell", action: "*", effect: "approve" } }), "az1"),
    step("deny", 0, log("authorization_denied", { reason: "policy_denied" }), "az2"),
  ];
  const rows = byAction(events);
  assert.deepEqual(rows.map((r) => r.id), ["rep", "other", "deny"], "newest first, one row per action");
  assert.deepEqual(rows[0].steps.map((s) => s.id), ["ask", "ok", "ran", "rep"], "steps oldest first");
  assert.deepEqual(trailOf(rows[0]), ["needs_approval", "approved", "ran"], "the two 'ran' steps say it once");
  assert.equal(decidingStep(rows[0]).id, "ok", "a person's decision is what decided it");
  assert.equal(decidingStep(rows[2]).id, "deny");
  assert.equal(decidingStep(rows[1]).id, "other", "nothing decided: the row itself");
});
