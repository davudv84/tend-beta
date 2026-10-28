import assert from "node:assert/strict";
import { test } from "node:test";
import { testState } from "./onboarding.ts";
import type { Agent, Authorization, TaskEvent } from "./types";

const T0 = 1_000_000;
const agent = (over: Partial<Agent> = {}) => ({ id: "a1", connectedAt: T0, lastSeenAt: T0 + 1000, ...over }) as Agent;
const auth = (over: Partial<Authorization> = {}) =>
  ({ id: "az1", agentId: "a1", tool: "test_ping", action: "ping", status: "pending", createdAt: T0 + 2000, expiresAt: T0 + 600_000, alerts: 0, ...over }) as Authorization;
const call = (over: Partial<TaskEvent> = {}) => ({ id: "e1", type: "tool.called", agentId: "a1", authorizationId: "az1", via: "gateway", outcome: "success", ...over }) as TaskEvent;
const kind = (a: Agent | undefined, auths: Authorization[], events: TaskEvent[] = [], now = T0 + 5000) => testState(a, auths, events, now).kind;

test("an agent that has never made an authenticated call is not connected, whatever else exists", () => {
  assert.equal(kind(agent({ lastSeenAt: undefined }), [auth()]), "waiting_connection");
  assert.equal(kind(undefined, []), "waiting_connection");
});

test("connected means a real call arrived; the test then moves through the real authorization states", () => {
  assert.equal(kind(agent(), []), "connected");
  assert.equal(kind(agent(), [auth({ status: "denied" })]), "blocked");
  assert.equal(kind(agent(), [auth({ status: "pending" })]), "pending");
  assert.equal(kind(agent(), [auth({ status: "approved" })]), "approved");
  assert.equal(kind(agent(), [auth({ status: "rejected" })]), "rejected");
  assert.equal(kind(agent(), [auth({ status: "cancelled" })]), "closed");
  assert.equal(kind(agent(), [auth({ status: "pending", expiresAt: T0 + 3000 })], [], T0 + 4000), "closed", "lapsed before the server noticed");
});

test("verified only when Tend's own gateway record shows success for this very authorization", () => {
  const done = auth({ status: "consumed" });
  assert.equal(kind(agent(), [done]), "running", "consumed but no outcome recorded yet");
  assert.equal(kind(agent(), [done], [call()]), "verified");
  assert.equal(kind(agent(), [done], [call({ outcome: "failure" })]), "failed");
  assert.equal(kind(agent(), [done], [call({ via: undefined })]), "running", "an agent's own report is not proof");
  assert.equal(kind(agent(), [done], [call({ authorizationId: "other" })]), "running", "another authorization's outcome is not proof");
  assert.equal(kind(agent(), [done], [call({ type: "task.completed" })]), "running");
});

test("only this agent's test requests made after it was created count, and the newest wins", () => {
  assert.equal(kind(agent(), [auth({ agentId: "other" })]), "connected");
  assert.equal(kind(agent(), [auth({ tool: "write_note" })]), "connected");
  assert.equal(kind(agent(), [auth({ createdAt: T0 - 1 })]), "connected");
  assert.equal(kind(agent(), [auth({ id: "old", status: "rejected", createdAt: T0 + 1000 }), auth({ id: "new", status: "pending", createdAt: T0 + 4000 })]), "pending");
});

test("starting the test again ignores earlier results: the screen waits for a new request", () => {
  const old = auth({ id: "old", status: "rejected", createdAt: T0 + 2000 });
  assert.equal(testState(agent(), [old], [], T0 + 9000).kind, "rejected");
  assert.equal(testState(agent(), [old], [], T0 + 9000, T0 + 3000).kind, "connected", "a request from before the restart does not count");
  assert.equal(testState(agent(), [old, auth({ id: "new", status: "pending", createdAt: T0 + 4000 })], [], T0 + 9000, T0 + 3000).kind, "pending");
});
