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

// From the security review of 2026-10-31: an adapter sends long values as { sha256, length }; padding a value past that limit used to make a
// stricter rule's condition false, so the request fell through to a broader allow.
test("a condition on a summarized value applies a deny or approve rule and never an allow rule", () => {
  const agent = { status: "active" as const, integrationEnabled: true, permissions: [] };
  const policy = [
    { tool: "email", action: "*", effect: "allow" },
    { tool: "email", action: "*", effect: "approve", when: { body: { contains: "password" } } },
    { tool: "email", action: "*", effect: "deny", when: { to: { endsWith: "@evil.example" } } },
    { tool: "pay", action: "*", effect: "allow", when: { amount: { lte: 50 }, note: { contains: "ok" } } },
    { tool: "pay", action: "*", effect: "approve" },
    { tool: "nested", action: "*", effect: "allow" },
    { tool: "nested", action: "*", effect: "deny", when: { "payload.to": { in: ["boss@corp.example"] } } },
  ];
  const long = { sha256: "a".repeat(64), length: 9000 };
  const req = (tool: string, args: Record<string, unknown>): AuthRequest => ({ tool, action: "send", resource: null, detail: null, args });
  assert.equal(evaluate(agent, policy, req("email", { body: "hi", to: "a@b.example" })).effect, "allow", "readable and harmless: allowed as before");
  assert.equal(evaluate(agent, policy, req("email", { body: long, to: "a@b.example" })).effect, "approve", "an unreadable body may contain the word: a person decides");
  assert.equal(evaluate(agent, policy, req("email", { body: "hi", to: long })).effect, "deny", "an unreadable address may be the denied one");
  assert.equal(evaluate(agent, policy, req("pay", { amount: 10, note: long })).effect, "approve", "an allow rule whose condition cannot be read does not allow");
  assert.equal(evaluate(agent, policy, req("pay", { amount: 10, note: "ok" })).effect, "allow");
  assert.equal(evaluate(agent, policy, req("nested", { payload: long })).effect, "deny", "a path into a summarized object is unknown, not missing");
  assert.equal(evaluate(agent, policy, req("email", { body: [long, "x"], to: "a@b.example" })).effect, "approve", "a list with a summarized element is unknown too");
});

test("an unreadable value can make a decision stricter, never looser: a forged summary cannot lift a deny into the approval queue", () => {
  const agent = { status: "active" as const, integrationEnabled: true, permissions: [] };
  const policy = [
    { tool: "send_email", action: "*", effect: "approve", when: { to: { endsWith: "@partner.example" } } },
    { tool: "send_email", action: "*", effect: "deny" },
  ];
  const req = (to: unknown): AuthRequest => ({ tool: "send_email", action: "send", resource: null, detail: null, args: { to } });
  assert.equal(evaluate(agent, policy, req("x@evil.example")).effect, "deny");
  assert.equal(evaluate(agent, policy, req("a@partner.example")).effect, "approve");
  for (const forged of [{ sha256: "00", length: 999 }, [{ sha256: "00" }], { addr: "a@partner.example" }, [["a@partner.example"]]])
    assert.equal(evaluate(agent, policy, req(forged)).effect, "deny", JSON.stringify(forged));
});

test("notIn and equality hold only for plain values, compared as text: no null, object, nested list or type change slips past", () => {
  const agent = { status: "active" as const, integrationEnabled: true, permissions: [] };
  const allowUnlessBoss = [
    { tool: "send_email", action: "*", effect: "allow", when: { to: { notIn: ["boss@corp.example", 1001] } } },
    { tool: "send_email", action: "*", effect: "deny" },
  ];
  const req = (to: unknown): AuthRequest => ({ tool: "send_email", action: "send", resource: null, detail: null, args: { to } });
  assert.equal(evaluate(agent, allowUnlessBoss, req("ana@corp.example")).effect, "allow");
  for (const bad of ["boss@corp.example", [["boss@corp.example"]], { addr: "boss@corp.example" }, null, true, "1001", 1001])
    assert.equal(evaluate(agent, allowUnlessBoss, req(bad)).effect, "deny", JSON.stringify(bad));
  const denyAmount = [{ tool: "pay", action: "*", effect: "allow" }, { tool: "pay", action: "*", effect: "deny", when: { amount: { in: [1001] } } }];
  const pay = (amount: unknown): AuthRequest => ({ tool: "pay", action: "send", resource: null, detail: null, args: { amount } });
  assert.equal(evaluate(agent, denyAmount, pay("1001")).effect, "deny", "a number sent as text is the same number");
  assert.equal(evaluate(agent, denyAmount, pay(5)).effect, "allow");
});

test("request text with hidden characters is refused, and arguments nested thousands deep are refused instead of crashing", async () => {
  const { parseAuthRequest } = await import("./policy.ts");
  for (const hidden of [0xe0041, 0x3164, 0x115f, 0x2800, 0x34f, 0xe0100]) {
    const r = parseAuthRequest({ tool: "send_email", action: "send", detail: `pay 5 EUR${String.fromCodePoint(hidden)}` });
    assert.equal(r.ok, false, hidden.toString(16));
  }
  assert.equal(parseAuthRequest({ tool: "send_email", action: "send", detail: "done ✔️ 🎉" }).ok, true, "ordinary emoji stay allowed");
  let deep: unknown = "x";
  for (let i = 0; i < 20_000; i++) deep = { a: deep };
  const r = parseAuthRequest({ tool: "t", action: "a", args: { deep } });
  assert.equal(r.ok, false);
});
