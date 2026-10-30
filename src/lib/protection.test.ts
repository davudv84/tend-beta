import assert from "node:assert/strict";
import { test } from "node:test";
import { evidenceOf, pendingTest, presenceOf, RUNNING_FOR } from "./protection.ts";
import type { Authorization, TaskEvent } from "./types";

const NOW = 50_000_000;
const auth = (over: Partial<Authorization>) => ({ id: "az", agentId: "a", tool: "shell", action: "Bash", status: "consumed", createdAt: NOW - 1000, alerts: 0, ...over }) as Authorization;
const ran = (over: Partial<TaskEvent>) => ({ id: "e", seq: 1, agentId: "a", at: NOW - 500, type: "tool.called", outcome: "success", source: "agent", ...over }) as TaskEvent;

test("running, quiet, stopped, lost and never come only from what TEND heard and when", () => {
  assert.equal(presenceOf({}, NOW), "never", "registered is not connected");
  assert.equal(presenceOf({ lastSeenAt: NOW - 1000 }, NOW), "running");
  assert.equal(presenceOf({ lastSeenAt: NOW - RUNNING_FOR - 1 }, NOW), "quiet");
  assert.equal(presenceOf({ lastSeenAt: NOW - 1000, disconnectedAt: NOW - 1000 }, NOW), "stopped", "a session that ended says so");
  assert.equal(presenceOf({ lastSeenAt: NOW - 2 * 86_400_000 }, NOW), "lost");
  assert.equal(presenceOf({ lastSeenAt: NOW - 1000, disconnectedAt: NOW - 5000 }, NOW), "running", "activity after the last end: a new session");
});

test("a protection counts as working only when this agent's own records show it", () => {
  const none = evidenceOf({ id: "a" }, [], []);
  assert.deepEqual([none.connection, none.monitoring, none.blocking, none.approval], ["not_verified", "not_verified", "not_verified", "not_verified"]);

  const blocked = auth({ id: "b", detail: "Run: echo tend-blocked-test", status: "denied" });
  const approved = auth({ id: "p", detail: "Run: echo tend-approval-test", status: "consumed", reason: "approval_required", decidedAt: NOW - 800 });
  const e = evidenceOf({ id: "a", lastSeenAt: NOW - 100 }, [blocked, approved], [ran({ authorizationId: "p" })]);
  assert.deepEqual([e.connection, e.monitoring, e.blocking, e.approval], ["working", "working", "working", "working"]);

  assert.equal(evidenceOf({ id: "a" }, [approved], []).approval, "not_verified", "approved and spent, but no run reported: not shown as working");
  assert.equal(evidenceOf({ id: "a" }, [{ ...approved, reason: "policy_allowed" }], [ran({ authorizationId: "p" })]).approval, "not_verified", "allowed by policy is not a person's approval");
  assert.equal(evidenceOf({ id: "a" }, [blocked], [ran({ authorizationId: "b" })]).blocking, "not_verified", "a run reported for it means it was not blocked");
  assert.equal(evidenceOf({ id: "a" }, [], [ran({ via: "gateway" })]).monitoring, "not_verified", "TEND's own gateway record is not the assistant reporting");
  assert.equal(evidenceOf({ id: "a" }, [{ ...blocked, agentId: "other" }], []).blocking, "not_verified", "another agent's record does not count");
  assert.equal(evidenceOf({ id: "a", lastSeenAt: NOW - 100 }, [blocked], [], NOW).blocking, "not_verified", "before the test started does not count");
});

test("the waiting approval test is found so it can be answered in place", () => {
  const p = auth({ id: "w", detail: "Run: echo tend-approval-test", status: "pending", expiresAt: NOW + 1000 });
  assert.equal(pendingTest("a", [p], NOW)?.id, "w");
  assert.equal(pendingTest("a", [{ ...p, expiresAt: NOW - 1 }], NOW), undefined);
  assert.equal(pendingTest("a", [{ ...p, detail: "Run: git push" }], NOW), undefined, "only the test command, never a real request");
});
