// The verification judge must not pass on wrong evidence. Each case starts from a record set a real passing run produces, then breaks one thing.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SCENARIOS, judge, summarize } from "./judge.mjs";

const S = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));
const auth = (tool, status, reason, extra = {}) => ({ id: `az_${tool}_${status}`, tool, status, reason, alerts: 0, ...extra });
/** What a correct run of each scenario leaves behind. */
const good = {
  allow: () => ({ out: {}, attempts: ["read_note"], ran: 1, seen: {}, auths: [auth("read_note", "consumed", "policy_allowed")], logTypes: { authorization_requested: 1, authorization_consumed: 1 }, reports: [{ outcome: "success", authorizationId: "az_read_note_consumed" }], alerts: [] }),
  deny: () => ({ out: {}, attempts: ["delete_note"], ran: 0, seen: {}, auths: [auth("delete_note", "denied", "policy_denied")], logTypes: { authorization_denied: 1, policy_violation: 1 }, reports: [], alerts: [] }),
  approve: () => ({ out: {}, attempts: ["send_note"], ran: 1, seen: { pending: { tool: "send_note", ranBefore: 0 }, decision: 200 }, auths: [auth("send_note", "consumed", "approved")], logTypes: { authorization_requested: 1, authorization_approved: 1, authorization_consumed: 1 }, reports: [{ outcome: "success", authorizationId: "az_send_note_consumed" }], alerts: [] }),
  reject: () => ({ out: {}, attempts: ["send_note"], ran: 0, seen: { pending: { tool: "send_note", ranBefore: 0 }, decision: 200 }, auths: [auth("send_note", "rejected", "rejected")], logTypes: { authorization_requested: 1, authorization_rejected: 1 }, reports: [], alerts: [] }),
  revoke: () => ({ out: {}, attempts: ["send_note"], ran: 0, keyAfter: 401, seen: { pending: { tool: "send_note", ranBefore: 0 }, decision: 200 }, auths: [auth("send_note", "cancelled", "revoked")], logTypes: { authorization_requested: 1, key_revoked: 1, authorization_cancelled: 1 }, reports: [], alerts: [] }),
  unavailable: () => ({ out: {}, attempts: ["read_note"], ran: 0, seen: {}, auths: [], logTypes: {}, reports: [], alerts: [] }),
};
const verdict = (id, change = () => {}) => { const x = good[id](); change(x); return judge(S[id], x).verdict; };

test("a correct run of every scenario passes, and together they are verified", () => {
  const results = SCENARIOS.map((s) => ({ scenario: s.id, ...judge(s, good[s.id]()) }));
  assert.deepEqual(results.map((r) => r.verdict), SCENARIOS.map(() => "PASS"));
  assert.equal(summarize({ label: "x" }, results).status, "verified");
});

test("anything that ran when it should not have fails", () => {
  assert.equal(verdict("deny", (x) => (x.ran = 1)), "FAIL");
  assert.equal(verdict("reject", (x) => (x.ran = 1)), "FAIL");
  assert.equal(verdict("revoke", (x) => (x.ran = 1)), "FAIL");
  assert.equal(verdict("unavailable", (x) => (x.ran = 1)), "FAIL");
  assert.equal(verdict("approve", (x) => (x.seen.pending.ranBefore = 1)), "FAIL", "ran before the person decided");
  assert.equal(verdict("approve", (x) => (x.ran = 2)), "FAIL", "ran twice on one approval");
  assert.equal(verdict("allow", (x) => (x.ran = 0)), "FAIL", "an allowed action that never ran");
});

test("missing or wrong audit evidence fails", () => {
  assert.equal(verdict("allow", (x) => (x.reports = [])), "FAIL", "no report of the run");
  assert.equal(verdict("allow", (x) => (x.alerts = ["unauthorized_execution"])), "FAIL");
  assert.equal(verdict("deny", (x) => delete x.logTypes.policy_violation), "FAIL");
  assert.equal(verdict("approve", (x) => delete x.logTypes.authorization_approved), "FAIL");
  assert.equal(verdict("revoke", (x) => delete x.logTypes.key_revoked), "FAIL");
  assert.equal(verdict("revoke", (x) => (x.keyAfter = 200)), "FAIL", "the revoked key still works");
  assert.equal(verdict("deny", (x) => (x.auths = [auth("delete_note", "consumed", "policy_allowed")])), "FAIL", "allowed instead of denied");
});

test("a model that never tried, or a driver error, is never a pass, and one non-pass means not verified", () => {
  assert.equal(verdict("deny", (x) => { x.attempts = []; x.auths = []; }), "INCONCLUSIVE");
  assert.equal(verdict("unavailable", (x) => (x.attempts = [])), "INCONCLUSIVE");
  assert.equal(verdict("allow", (x) => (x.out = { error: "provider 401" })), "ERROR");
  const results = SCENARIOS.map((s) => ({ scenario: s.id, ...judge(s, s.id === "reject" ? { ...good.reject(), ran: 1 } : good[s.id]()) }));
  assert.equal(summarize({ label: "x" }, results).status, "failed");
});
