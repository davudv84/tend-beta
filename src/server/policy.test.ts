import assert from "node:assert/strict";
import { test } from "node:test";
import { memoryDb } from "./db.ts";
import { evaluate, fingerprint, parseAuthRequest, parsePolicy, type AuthRequest } from "./policy.ts";
import { registerAgent } from "./repo.ts";

const agent = (over: object = {}) => ({ status: "active" as const, integrationEnabled: true, permissions: [] as string[], ...over });
const req = (over: Partial<AuthRequest> = {}): AuthRequest => ({ tool: "send_payment", action: "execute", resource: "INV-1", detail: "EUR 5.00 to Test GmbH", ...over });
const pay = [{ tool: "send_payment", action: "execute", effect: "approve" }];

test("no policy, a malformed policy or an unknown tool is denied", () => {
  for (const raw of ["[]", "", "not json", "{}", "null", 7, undefined])
    assert.equal(evaluate(agent(), raw, req()).effect, "deny", String(raw));
  assert.equal(evaluate(agent(), "[]", req()).reason, "no_policy");
  assert.equal(evaluate(agent(), "nope", req()).reason, "invalid_policy");
  assert.equal(evaluate(agent(), pay, req({ tool: "other_tool" })).reason, "no_policy");
  assert.equal(evaluate(agent(), pay, req({ action: "read" })).reason, "no_policy");
});

test("one bad rule invalidates the whole policy, so it cannot be half applied", () => {
  const good = { tool: "read_document", action: "*", effect: "allow" };
  for (const bad of [
    { tool: "send_payment", action: "execute", effect: "yes" },
    { tool: "send payment", action: "execute", effect: "allow" },
    { tool: "x", action: "", effect: "allow" },
    { tool: "x", action: "*", effect: "allow", extra: 1 },
    { tool: "x", action: "*", effect: "allow", permission: "Docs Read" },
    { tool: "x", action: "*", effect: "allow", resourcePrefix: "a b" },
    { tool: 5, action: "*", effect: "allow" },
    "rule", null, [],
  ]) {
    assert.equal(parsePolicy([good, bad]).ok, false, JSON.stringify(bad));
    assert.equal(evaluate(agent(), [good, bad], req({ tool: "read_document", action: "read" })).reason, "invalid_policy");
  }
  assert.equal(parsePolicy(Array.from({ length: 51 }, () => good)).ok, false);
  assert.equal(parsePolicy([good]).ok, true);
});

test("effects: allow, approve and deny", () => {
  const rules = (effect: string) => [{ tool: "send_payment", action: "execute", effect }];
  assert.deepEqual(evaluate(agent(), rules("allow"), req()), { effect: "allow", reason: "policy_allowed" });
  assert.deepEqual(evaluate(agent(), rules("approve"), req()), { effect: "approve", reason: "approval_required" });
  assert.deepEqual(evaluate(agent(), rules("deny"), req()), { effect: "deny", reason: "policy_denied" });
});

test("the most specific rule wins and ties go to the stricter effect", () => {
  const rules = [
    { tool: "read_document", action: "*", effect: "allow" },
    { tool: "read_document", action: "read", resourcePrefix: "DOC-R-", effect: "approve" },
    { tool: "read_document", action: "read", resourcePrefix: "DOC-R-9", effect: "deny" },
  ];
  const doc = (resource: string | null) => evaluate(agent(), rules, req({ tool: "read_document", action: "read", resource })).effect;
  assert.equal(doc("DOC-P-1"), "allow");
  assert.equal(doc("DOC-R-201"), "approve");
  assert.equal(doc("DOC-R-901"), "deny");
  assert.equal(doc(null), "allow"); // a prefix rule never matches a request with no resource
  const tie = [{ tool: "t", action: "a", effect: "allow" }, { tool: "t", action: "a", effect: "deny" }, { tool: "t", action: "a", effect: "approve" }];
  assert.equal(evaluate(agent(), tie, req({ tool: "t", action: "a" })).effect, "deny");
  // A broad deny does not beat a narrower allow: specificity decides, so write deny rules at the same level.
  assert.equal(evaluate(agent(), [{ tool: "t", action: "*", effect: "deny" }, { tool: "t", action: "a", effect: "allow" }], req({ tool: "t", action: "a" })).effect, "allow");
});

test("a rule that needs a permission is denied until the agent holds it, using server-side data", () => {
  const rules = [{ tool: "read_document", action: "read", resourcePrefix: "DOC-R-", effect: "allow", permission: "docs.restricted.read" }];
  const read = req({ tool: "read_document", action: "read", resource: "DOC-R-201" });
  assert.equal(evaluate(agent(), rules, read).reason, "missing_permission");
  assert.equal(evaluate(agent({ permissions: ["docs.restricted.read"] }), rules, read).effect, "allow");
});

test("a paused or disabled agent is denied even when the policy allows everything", () => {
  const all = [{ tool: "send_payment", action: "execute", effect: "allow" }];
  assert.equal(evaluate(agent({ status: "paused" }), all, req()).reason, "agent_paused");
  assert.equal(evaluate(agent({ integrationEnabled: false }), all, req()).reason, "integration_disabled");
  assert.equal(evaluate(agent({ status: "idle" }), all, req()).effect, "allow");
});

test("requests are validated strictly: no coercion, trimming, truncation or unknown fields", () => {
  const ok = parseAuthRequest({ tool: "send_payment", action: "execute", resource: "INV-1", detail: "EUR 5.00" });
  assert.deepEqual(ok, { ok: true, request: { tool: "send_payment", action: "execute", resource: "INV-1", detail: "EUR 5.00" } });
  assert.deepEqual((parseAuthRequest({ tool: "t", action: "a" }) as { request: AuthRequest }).request, { tool: "t", action: "a", resource: null, detail: null });
  const bad: unknown[] = [
    null, [], "x", 5, {},
    { tool: "t" }, { action: "a" },
    { tool: "t", action: "a", extra: 1 },
    { tool: 5, action: "a" },
    { tool: " t", action: "a" },
    { tool: "t/../x", action: "a" },
    { tool: "t".repeat(65), action: "a" },
    { tool: "t", action: "a", resource: "a b" },
    { tool: "t", action: "a", resource: ["x"] },
    { tool: "t", action: "a", detail: "" },
    { tool: "t", action: "a", detail: "x".repeat(201) },
    { tool: "t", action: "a", detail: "line\nbreak" },
    { tool: "t", action: "a", detail: 5 },
    // Text that would display differently from what it is: bidi overrides and isolates, zero-width, C1 and soft hyphen.
    ...[0x202e, 0x2066, 0x200b, 0x200f, 0x061c, 0xfeff, 0x0085, 0x00ad, 0x2028].map((c) => ({ tool: "t", action: "a", detail: `EUR 5.00 to ${String.fromCharCode(c)}X` })),
  ];
  for (const b of bad) assert.equal(parseAuthRequest(b).ok, false, JSON.stringify(b));
  assert.equal(parseAuthRequest({ tool: "t", action: "a", detail: "x".repeat(200) }).ok, true);
  // Ordinary non-ASCII text is fine.
  assert.equal(parseAuthRequest({ tool: "t", action: "a", detail: "EUR 5,00 an Müller & Söhne – Ünïcødé 東京" }).ok, true);
});

test("the fingerprint changes with every bound field and cannot be confused across fields", () => {
  const base = fingerprint("agent-1", req());
  assert.equal(base, fingerprint("agent-1", req()));
  for (const other of [fingerprint("agent-2", req()), fingerprint("agent-1", req({ tool: "send_refund" })), fingerprint("agent-1", req({ action: "create" })),
    fingerprint("agent-1", req({ resource: "INV-2" })), fingerprint("agent-1", req({ resource: null })), fingerprint("agent-1", req({ detail: "EUR 9000.00 to Test GmbH" })), fingerprint("agent-1", req({ detail: null }))])
    assert.notEqual(other, base);
  // Moving a character between neighbouring fields must not give the same hash.
  assert.notEqual(fingerprint("a", { tool: "ab", action: "c", resource: null, detail: null }), fingerprint("a", { tool: "a", action: "bc", resource: null, detail: null }));
  assert.match(base, /^[0-9a-f]{64}$/);
});

test("migration: new agents are in monitor mode with an empty policy, and no token can exist unless a row is approved or consumed", async () => {
  const db = await memoryDb();
  const { agent: a } = await registerAgent(db, { name: "Probe", model: "m", provider: "Anthropic" });
  const row = await db.get<{ enforcement: string; policy: string }>("SELECT enforcement, policy FROM agents WHERE id = ?", a.id);
  assert.deepEqual(row, { enforcement: "monitor", policy: "[]" });
  await assert.rejects(() => db.run("UPDATE agents SET enforcement = 'maybe' WHERE id = ?", a.id));

  const insert = (id: string, status: string, token: string | null) => db.run(
    "INSERT INTO authorizations (id, agent_id, tool, action, fingerprint, status, created_at, expires_at, token_hash) VALUES (?, ?, 't', 'a', 'f', ?, 0, 1, ?)", id, a.id, status, token);
  for (const status of ["pending", "rejected", "expired", "denied", "cancelled"]) await assert.rejects(() => insert(`x-${status}`, status, "hash"), status);
  await assert.rejects(() => insert("bad", "bogus", null));
  await insert("ok1", "approved", "h1");
  await insert("ok2", "consumed", "h2");
  await insert("ok3", "pending", null);
  await assert.rejects(() => insert("dup", "approved", "h1")); // a token hash is unique
  await db.run("INSERT INTO authorizations (id, agent_id, tool, action, fingerprint, status, created_at, expires_at, idempotency_key) VALUES ('i1', ?, 't', 'a', 'f', 'pending', 0, 1, 'k')", a.id);
  await assert.rejects(() => db.run("INSERT INTO authorizations (id, agent_id, tool, action, fingerprint, status, created_at, expires_at, idempotency_key) VALUES ('i2', ?, 't', 'a', 'f', 'pending', 0, 1, 'k')", a.id));
  await db.close();
});
