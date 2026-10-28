import assert from "node:assert/strict";
import { test } from "node:test";
import type { TimelineEvent } from "./derive.ts";
import { inGroup, outcomeOf, visibleAgent } from "./activity.ts";

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
