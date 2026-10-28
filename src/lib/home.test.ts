import assert from "node:assert/strict";
import { test } from "node:test";
import { toolCatalog } from "../server/gateway.ts";
import { FLOOD_AT, connectionOf, homeQueue, needsAttention, needsConfirmation, orderAssistants, otherRequests, protectionOf, realAssistants, requestKind, showsContent, summarize, type Runs } from "./home.ts";
import type { Agent, Authorization, CheckIn, ReviewRequest } from "./types";
import type { CheckResult, VerificationRun } from "./verification.ts";

const NOW = 10_000_000;
const agent = (id: string, over: Partial<Agent> = {}) => ({ id, name: id, origin: "connected", status: "active", integrationEnabled: true, configVersion: 1, connectedAt: 1, permissions: [], ...over }) as Agent;
const auth = (id: string, agentId: string, over: Partial<Authorization> = {}) =>
  ({ id, agentId, tool: "write_note", action: "create", status: "pending", createdAt: NOW - 1000, expiresAt: NOW + 600_000, alerts: 0, ...over }) as Authorization;
const check = (id: string, status: CheckResult["status"]) => ({ id, group: "live", status, facts: {} }) as CheckResult;
const run = (checks: CheckResult[], over: Partial<VerificationRun> = {}) => ({ id: "vr", agentId: "a", at: NOW - 5000, configVersion: 1, enforcement: "enforce", durationMs: 1, checks, runsWithoutAsking: [], ...over }) as VerificationRun;

test("Home shows real assistants only: sample assistants never appear in the queue, the counts or the list", () => {
  const agents = [agent("real"), agent("sample", { origin: "demo" })];
  const q = homeQueue(agents, [auth("a1", "real"), auth("a2", "sample")], NOW);
  assert.deepEqual(q.waiting.map((r) => r.auth.id), ["a1"]);
  assert.deepEqual(realAssistants(agents).map((a) => a.id), ["real"]);
  assert.deepEqual(orderAssistants(agents, new Map(), q.waiting).map((a) => a.id), ["real"]);
  const review = { id: "c1", agentId: "sample", review: { status: "pending" } } as CheckIn;
  assert.equal(otherRequests(agents, [review], []), 0, "a sample assistant's review is not an open request");
  assert.equal(otherRequests(agents, [{ ...review, agentId: "real" }], [{ id: "r1", agentId: "real", review: { status: "pending" } } as ReviewRequest, { id: "r2", agentId: "real", review: { status: "approved" } } as ReviewRequest]), 2);
});

test("requests wait soonest-to-lapse first; lapsed ones are counted, never shown as answerable", () => {
  const agents = [agent("a"), agent("b")];
  const q = homeQueue(agents, [
    auth("late", "a", { expiresAt: NOW + 500_000 }), auth("soon", "b", { expiresAt: NOW + 60_000 }), auth("same-1", "a", { expiresAt: NOW + 300_000, createdAt: NOW - 50 }), auth("same-0", "b", { expiresAt: NOW + 300_000, createdAt: NOW - 90 }),
    auth("gone", "a", { expiresAt: NOW - 1000 }), auth("old", "a", { expiresAt: NOW - 5_000_000 }), auth("closed", "a", { status: "expired", closedAt: NOW - 60_000 }),
    auth("approved", "a", { status: "approved" }), auth("rejected", "b", { status: "rejected" }),
  ], NOW);
  assert.deepEqual(q.waiting.map((r) => r.auth.id), ["soon", "same-0", "same-1", "late"]);
  assert.equal(q.lapsed, 2, "one lapsed without being closed, one closed as expired; the old one is out of the hour");
});

test("an assistant that asks unusually often is flagged, so a flood can't hide the one request that matters", () => {
  const many = Array.from({ length: FLOOD_AT }, (_, i) => auth(`f${i}`, "noisy"));
  const q = homeQueue([agent("noisy"), agent("quiet")], [...many, auth("q", "quiet")], NOW);
  assert.deepEqual(q.floods.map((f) => [f.agent.id, f.waiting]), [["noisy", FLOOD_AT]]);
  assert.equal(homeQueue([agent("noisy")], many.slice(1), NOW).floods.length, 0);
});

test("a spending or unrecognised request needs a second confirmation; known harmless ones don't; the table matches the gateway", () => {
  for (const [tool, kind] of [["pay_invoice", "spend"], ["write_note", "write"], ["read_note", "read"], ["list_notes", "read"], ["test_ping", "test"], ["send_email", "unknown"]] as const) assert.equal(requestKind(tool), kind, tool);
  assert.deepEqual(["spend", "unknown", "write", "read", "test"].map((k) => needsConfirmation(k as never)), [true, true, false, false, false]);
  assert.deepEqual(["write", "spend", "unknown", "read", "test"].map((k) => showsContent(k as never)), [true, true, true, false, false]);
  // Whatever the gateway can run is classified the way the gateway classifies it: a new tool can't silently become "unknown".
  for (const t of toolCatalog()) assert.equal(requestKind(t.tool), t.risk, `${t.tool}: the screen and the gateway disagree`);
});

test("an At Risk check always surfaces, even from an old run, and is marked out of date rather than dropped", () => {
  const a = agent("a", { configVersion: 3 }), b = agent("b"), c = agent("c"), sample = agent("s", { origin: "demo" });
  const runs: Runs = new Map([
    ["a", run([check("x", "at_risk"), check("y", "at_risk"), check("z", "verified")], { configVersion: 1 })],
    ["b", run([check("x", "at_risk")])], ["c", run([check("x", "verified"), check("y", "not_verified")])], ["s", run([check("x", "at_risk")])],
  ]);
  const att = needsAttention([a, b, c, sample], runs);
  assert.deepEqual(att.map((x) => [x.agent.id, x.atRisk.length, x.outOfDate]), [["a", 2, true], ["b", 1, false]]);
  assert.deepEqual(needsAttention([c], new Map([["c", null]])), [], "never run, nothing to surface");
  assert.equal(needsAttention([a], new Map([["a", undefined]])).length, 0, "not loaded yet");
});

test("each assistant gets one honest line: how it is connected, and what its protection checks last showed", () => {
  const now = Date.now();
  assert.equal(connectionOf(agent("x", { integrationEnabled: false }), now), "disabled");
  assert.equal(connectionOf(agent("x", { status: "paused" }), now), "paused");
  assert.equal(connectionOf(agent("x"), now), "never");
  assert.equal(connectionOf(agent("x", { lastSeenAt: now - 1000 }), now), "connected");
  assert.equal(connectionOf(agent("x", { lastSeenAt: now - 3_600_000 }), now), "offline");
  const a = agent("a", { configVersion: 2 });
  assert.deepEqual(protectionOf(a, undefined), { state: "unknown" });
  assert.deepEqual(protectionOf(a, null), { state: "not_run" });
  assert.deepEqual(protectionOf(a, run([check("x", "verified")])), { state: "ran", at: NOW - 5000, outOfDate: true });
  assert.deepEqual(protectionOf(a, run([check("x", "at_risk"), check("y", "at_risk")], { configVersion: 2 })), { state: "attention", at: NOW - 5000, atRisk: 2, outOfDate: false });
});

test("assistants that need a look come first: attention, then those waiting on you, then by name", () => {
  const agents = [agent("zed"), agent("amy"), agent("bob"), agent("cat")];
  const runs: Runs = new Map([["cat", run([check("x", "at_risk")])]]);
  const q = homeQueue(agents, [auth("1", "zed")], NOW);
  assert.deepEqual(orderAssistants(agents, runs, q.waiting).map((a) => a.id), ["cat", "zed", "amy", "bob"]);
});

test("the Home summary counts real assistants only, and only what is actually known", () => {
  const fresh = (id: string) => agent(id, { lastSeenAt: NOW - 1_000 });
  const stale = agent("stale", { lastSeenAt: NOW - 3_600_000 });
  const sample = agent("sample", { origin: "demo", lastSeenAt: NOW });
  const agents = [fresh("a"), fresh("b"), stale, sample];
  const s0 = summarize(agents, new Map(), 0, NOW);
  assert.deepEqual([s0.total, s0.connected, s0.checked, s0.notChecked, s0.needAttention], [3, 2, 0, 0, 0], "the sample is not counted, and unknown checks are neither run nor missing");
  const runs: Runs = new Map([["a", null], ["b", { configVersion: 1, at: NOW, checks: [] } as unknown as VerificationRun]]);
  const s1 = summarize(agents, runs, 1, NOW);
  assert.deepEqual([s1.checked, s1.notChecked, s1.needAttention], [1, 1, 1], "one ran, one has not, and a flooding assistant needs attention");
});
