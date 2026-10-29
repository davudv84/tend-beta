// Argument-aware rules: conditions on a request's arguments, bound to the authorization, failing closed. The four example policies,
// and the ways people try to slip past a domain allowlist.
import assert from "node:assert/strict";
import { test } from "node:test";
import { authAgent } from "./agent-auth.ts";
import { requestAuthorization, spendApproved } from "./authz.ts";
import { memoryDb } from "./db.ts";
import { evaluate, fingerprint, parsePolicy, type AuthRequest } from "./policy.ts";
import { decide, registerAgent, setPolicy } from "./repo.ts";
import { simulatePolicy } from "./simulate.ts";

process.env.TEND_DEMO = "0";
const active = { status: "active" as const, integrationEnabled: true, permissions: [] };
const ask = (tool: string, args: Record<string, unknown> | null): AuthRequest => ({ tool, action: "call", resource: null, detail: null, args });
const effect = (rules: unknown, tool: string, args: Record<string, unknown> | null) => evaluate(active, rules, ask(tool, args)).effect;

const EMAIL = [
  { tool: "send_email", action: "call", effect: "allow", when: { to: { emailDomainIn: ["company.com"] } } },
  { tool: "send_email", action: "call", effect: "deny" },
];

test("block sending outside an approved domain: only plain addresses on exactly that domain pass", () => {
  for (const to of ["ana@company.com", "Ana.B+x@COMPANY.com", ["a@company.com", "b@company.com"]]) assert.equal(effect(EMAIL, "send_email", { to }), "allow", JSON.stringify(to));
  for (const to of ["ana@evil.com", "ana@company.com.evil.com", "ana@sub.company.com", "ana@evilcompany.com", "Ana <ana@company.com>", "ana@company.com,eve@evil.com",
    "ana@company.com eve@evil.com", ["a@company.com", "eve@evil.com"], [], "", 42, null, { address: "a@company.com" }])
    assert.equal(effect(EMAIL, "send_email", { to }), "deny", JSON.stringify(to));
  assert.equal(effect(EMAIL, "send_email", {}), "deny", "a missing argument falls through to the deny");
  assert.equal(effect(EMAIL, "send_email", null), "deny", "no arguments at all, too");
});

test("approval for sensitive database operations, read but not modify, and no file deletion", () => {
  const db = [
    { tool: "db_query", action: "call", effect: "allow", when: { operation: { in: ["select"] } } },
    { tool: "db_query", action: "call", effect: "approve", when: { operation: { in: ["insert", "update"] } } },
    { tool: "db_query", action: "call", effect: "approve", when: { operation: { in: ["delete"] }, table: { notIn: ["audit_log"] } } },
    { tool: "db_query", action: "call", effect: "deny" },
    { tool: "records", action: "call", effect: "allow", when: { mode: { equals: "read" } } },
    { tool: "records", action: "call", effect: "deny" },
    { tool: "delete_file", action: "call", effect: "deny" },
    { tool: "refund", action: "call", effect: "allow", when: { amount: { lte: 50 }, currency: { equals: "EUR" } } },
    { tool: "refund", action: "call", effect: "approve" },
  ];
  assert.equal(parsePolicy(db).ok, true);
  assert.equal(effect(db, "db_query", { operation: "SELECT" }), "allow");
  assert.equal(effect(db, "db_query", { operation: "update", table: "orders" }), "approve");
  assert.equal(effect(db, "db_query", { operation: "delete", table: "orders" }), "approve");
  assert.equal(effect(db, "db_query", { operation: "delete", table: "audit_log" }), "deny", "the more specific delete rule does not match, so the catch-all denies");
  assert.equal(effect(db, "db_query", { operation: "drop" }), "deny");
  assert.equal(effect(db, "records", { mode: "read", id: 7 }), "allow");
  assert.equal(effect(db, "records", { mode: "write", id: 7 }), "deny");
  assert.equal(effect(db, "delete_file", { path: "notes.txt" }), "deny");
  assert.equal(effect(db, "refund", { amount: 20, currency: "eur" }), "allow");
  assert.equal(effect(db, "refund", { amount: 500, currency: "EUR" }), "approve");
  assert.equal(effect(db, "refund", { amount: "20", currency: "EUR" }), "approve", "a number given as text does not satisfy a numeric condition");
});

test("conditions are validated strictly: an unknown condition, a bad value or path invalidates the whole policy (which then denies)", () => {
  for (const when of [{ to: { matches: ".*" } }, { to: {} }, { "bad path!": { equals: "x" } }, { amount: { lt: "5" } }, { to: { emailDomainIn: ["not a domain"] } }, {}, []])
    assert.equal(parsePolicy([{ tool: "t", action: "call", effect: "allow", when }]).ok, false, JSON.stringify(when));
  assert.equal(effect([{ tool: "t", action: "call", effect: "allow", when: { x: { matches: ".*" } } }], "t", { x: "y" }), "deny");
});

test("an authorization is bound to its arguments: same arguments in any key order match, any other arguments do not", async () => {
  assert.equal(fingerprint("a", ask("t", { x: 1, y: "z" })), fingerprint("a", ask("t", { y: "z", x: 1 })));
  assert.notEqual(fingerprint("a", ask("t", { x: 1 })), fingerprint("a", ask("t", { x: 2 })));
  assert.notEqual(fingerprint("a", ask("t", { x: 1 })), fingerprint("a", ask("t", null)));
  const db = await memoryDb();
  const r = await registerAgent(db, { name: "Mailer", model: "m", provider: "Custom" });
  await setPolicy(db, r.agent.id, [{ tool: "send_email", action: "call", effect: "approve", when: { to: { emailDomainIn: ["company.com"] } } }, { tool: "send_email", action: "call", effect: "deny" }], "enforce");
  const agent = (await authAgent(db, new Request("http://t/", { headers: { authorization: `Bearer ${r.apiKey}` } })))!;
  const req = { tool: "send_email", action: "call", args: { to: "ana@company.com" } };
  const { view } = await requestAuthorization(db, agent, req, null, Date.now(), { spend: true });
  assert.equal(view.status, "pending");
  await decide(db, view.id, "approved");
  await assert.rejects(spendApproved(db, agent, view.id, { ...req, args: { to: "eve@evil.com" } }), (e: { code?: string }) => e.code === "mismatch", "approved for one address, spent for another: refused");
  assert.equal((await spendApproved(db, agent, view.id, req)).authorized, true);
  await assert.rejects(spendApproved(db, agent, view.id, req), (e: { code?: string }) => e.code === "already_consumed");
  const denied = await requestAuthorization(db, agent, { ...req, args: { to: "eve@evil.com" } }, null, Date.now(), { spend: true });
  assert.equal(denied.view.status, "denied");
  // Simulation sees the recorded arguments too: widening the domain list would change the denied one.
  const sim = await simulatePolicy(db, { agentId: r.agent.id, rules: [{ tool: "send_email", action: "call", effect: "approve", when: { to: { emailDomainIn: ["company.com", "evil.com"] } } }, { tool: "send_email", action: "call", effect: "deny" }] });
  assert.deepEqual(sim.changes, { "deny->approve": 1 });
  await db.close();
});

test("resource restrictions on file paths cannot be walked out of", () => {
  const files = [
    { tool: "write_file", action: "call", effect: "allow", when: { path: { pathUnder: ["/data/reports"] } } },
    { tool: "write_file", action: "call", effect: "deny" },
  ];
  assert.equal(parsePolicy(files).ok, true);
  for (const path of ["/data/reports/q3.csv", "/data/reports", "/data//reports/./q3.csv", "/data/reports/sub/x.txt"]) assert.equal(effect(files, "write_file", { path }), "allow", path);
  for (const path of ["/data/reports/../../etc/passwd", "/data/reports/..", "/data/reportsX/q3.csv", "/data/report", "/etc/passwd", "data/reports/q3.csv", "/data/reports\\..\\x", "/data/reports/\u0000x", "", 7])
    assert.equal(effect(files, "write_file", { path }), "deny", JSON.stringify(path));
  assert.equal(parsePolicy([{ tool: "t", action: "call", effect: "allow", when: { path: { pathUnder: ["/data/../etc"] } } }]).ok, false, "a rule cannot name a folder with .. in it");
});
