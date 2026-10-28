// Run with `npm test` (Node's built-in runner, native TypeScript stripping).
import assert from "node:assert/strict";
import { test } from "node:test";
import { needsReview, parseCheckIn, PROTOCOL } from "./contract.ts";
import { checkInEvent, health, logEvent, summarize } from "./derive.ts";
import { createSeed } from "./seed.ts";
import type { LogType } from "./types";

const responses = {
  instructions: { answer: "yes", confidence: 90 },
  context: { answer: "yes", confidence: 80 },
  conflicts: { answer: "no", confidence: 85 },
  review: { answer: "no", confidence: 95 },
  improvements: { answer: "no", confidence: 70 },
};

test("parseCheckIn accepts a valid payload and drops unknown fields", () => {
  const r = parseCheckIn({ protocol: PROTOCOL, agentId: "atlas", responses, feedback: " ok ", permissions: ["admin"], review: { status: "approved" } });
  assert.ok(r.ok);
  assert.equal(r.value.feedback, "ok");
  assert.equal("permissions" in r.value, false);
  assert.equal("review" in r.value, false);
  assert.equal(needsReview(r.value), false);
  assert.equal("reflection" in r.value, false);
  const withText = parseCheckIn({ protocol: PROTOCOL, agentId: "atlas", responses, reflection: "  A note.  " });
  assert.ok(withText.ok && withText.value.reflection === "A note.");
});

test("parseCheckIn rejects bad answers, confidence and permission requests", () => {
  const r = parseCheckIn({
    protocol: PROTOCOL, agentId: "atlas",
    responses: { ...responses, context: { answer: "maybe", confidence: 140 } },
    proposedAdjustment: { kind: "permission", title: "More access" },
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.errors.length, 3);
  assert.equal(parseCheckIn(null).ok, false);
});

test("proposed adjustments always require review", () => {
  const r = parseCheckIn({ protocol: PROTOCOL, agentId: "kestrel", responses, proposedAdjustment: { kind: "permission", title: "Write", permission: "calendar.write" } });
  assert.ok(r.ok && needsReview(r.value));
});

test("seed is coherent: three pending reviews, no composite scores", () => {
  const { agents, checkIns } = createSeed(Date.now());
  assert.equal(agents.length, 6);
  assert.equal(checkIns.filter((c) => c.review?.status === "pending").length, 3);
  const s = summarize(checkIns);
  assert.ok(s.n > 300 && s.instructions! > 50 && s.instructions! <= 100);
  const nova = checkIns.find((c) => c.agentId === "nova")!;
  assert.equal(checkInEvent(nova).kind, "conflict");
  assert.equal(health(checkIns.filter((c) => c.agentId === "nova").slice(0, 5)).level, "review");
  assert.ok(checkIns.filter((c) => c.reflection).length > 50);
});

test("authorization steps get their own timeline category; decisions stay decisions and misuse stays an alert", () => {
  const kind = (type: LogType) => logEvent({ id: "x", at: 0, agentId: "a", actor: "system", type, summary: "" }).kind;
  for (const t of ["authorization_requested", "authorization_denied", "authorization_consumed", "authorization_expired", "authorization_cancelled"] as const) assert.equal(kind(t), "authorization");
  assert.deepEqual([kind("authorization_approved"), kind("authorization_rejected")], ["decision", "decision"]);
  for (const t of ["authorization_replay", "authorization_mismatch", "unauthorized_execution"] as const) assert.equal(kind(t), "alert");
});

test("a policy change moves the agent's settings version and nothing else about its rules reaches the projection", async () => {
  const { applyEvents, emptyProjection } = await import("./projection.ts");
  const agent = { id: "a1", name: "A", configVersion: 1, ackedVersion: 1, permissions: [] } as never;
  const ev = (data: Record<string, unknown>) => ({ seq: 1, id: "e1", agentId: "a1", type: "policy.updated" as const, at: 1, actor: "human" as const, data });
  const p = applyEvents(emptyProjection([agent]), [ev({ version: 4, policy: [{ tool: "secret_tool", action: "x", effect: "allow" }], enforcement: "enforce", by: "0123456789abcdef" })]);
  assert.equal(p.agents[0].configVersion, 4);
  assert.equal(JSON.stringify(p).includes("secret_tool") || JSON.stringify(p).includes("0123456789abcdef"), false);
  assert.equal(applyEvents(emptyProjection([agent]), [ev({})]).agents[0].configVersion, 1, "no version, no change");
});
