// One central policy for several independent agents (a Claude agent and an OpenAI agent have different providers and different keys):
// applied to all of them or none, enforced per agent exactly as before, visible in one audit history, and revoking one agent leaves the other alone.
import assert from "node:assert/strict";
import { test } from "node:test";
import { authAgent } from "./agent-auth.ts";
import { requestAuthorization } from "./authz.ts";
import { memoryDb } from "./db.ts";
import { HttpError } from "./http.ts";
import { registerAgent, revokeKey, setPolicyMany } from "./repo.ts";
import { since, snapshot } from "./sync.ts";

const OPERATOR = { role: "operator" as const, canAct: true, public: false, operatorAvailable: true, demo: false };
const V1 = [{ tool: "read_ticket", action: "read", effect: "allow" }, { tool: "send_email", action: "send", effect: "approve" }, { tool: "delete_record", action: "delete", effect: "deny" }];
const V2 = V1.map((r) => (r.tool === "send_email" ? { ...r, effect: "deny" } : r));

async function setup() {
  const db = await memoryDb();
  const mk = async (name: string, provider: string) => {
    const r = await registerAgent(db, { name, model: "m", provider });
    return { id: r.agent.id, key: r.apiKey };
  };
  const claude = await mk("Claude agent", "Anthropic"), openai = await mk("OpenAI agent", "OpenAI");
  // Each agent proves itself with its own key, the way the API does.
  const as = (a: { key: string }) => authAgent(db, new Request("http://localhost/api/v1/authorizations", { headers: { authorization: `Bearer ${a.key}` } }));
  const ask = async (a: { key: string }, tool: string, action: string, resource: string) => (await requestAuthorization(db, await as(a), { tool, action, resource, detail: `${tool} ${resource}` }, null)).view;
  const version = async (id: string) => (await db.get<{ config_version: number }>("SELECT config_version FROM agents WHERE id = ?", id))!.config_version;
  const stored = async (id: string) => JSON.parse((await db.get<{ policy: string }>("SELECT policy FROM agents WHERE id = ?", id))!.policy);
  return { db, claude, openai, as, ask, version, stored };
}
const refused = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, code: e.code };
    throw e;
  }
  return assert.fail("expected the call to be refused");
};

test("one central call puts the same rules on every listed agent, and each gets its own audit event", async () => {
  const c = await setup();
  const [vc, vo] = [await c.version(c.claude.id), await c.version(c.openai.id)];
  const events = await setPolicyMany(c.db, [c.claude.id, c.openai.id], V1, "enforce", "operator-session-1");
  assert.equal(events.length, 2);
  assert.deepEqual(await c.stored(c.claude.id), V1);
  assert.deepEqual(await c.stored(c.openai.id), V1);
  assert.equal(await c.version(c.claude.id), vc + 1);
  assert.equal(await c.version(c.openai.id), vo + 1);
  const changes = (await since(c.db, OPERATOR, 0)).events.filter((e) => e.type === "policy.updated");
  assert.deepEqual(new Set(changes.map((e) => e.agentId)), new Set([c.claude.id, c.openai.id]), "both agents' policy changes are in the one history");
  for (const e of changes) {
    assert.equal(e.data.central, 2, "marked as one central change over two agents");
    assert.deepEqual(e.data.policy, V1, "the full rule set that took effect is recorded");
    assert.equal(e.data.by, "operator-session-1", "and who made the change");
  }
});

test("each agent is held to the central policy with its own key, and changing it once changes both without touching either agent", async () => {
  const c = await setup();
  await setPolicyMany(c.db, [c.claude.id, c.openai.id], V1, "enforce");
  for (const [i, a] of [c.claude, c.openai].entries()) {
    assert.equal((await c.ask(a, "read_ticket", "read", `t-${i}`)).status, "approved", "allowed by policy");
    assert.equal((await c.ask(a, "send_email", "send", `m-${i}`)).status, "pending", "held for a person");
    assert.equal((await c.ask(a, "delete_record", "delete", `r-${i}`)).status, "denied", "refused");
  }
  await setPolicyMany(c.db, [c.claude.id, c.openai.id], V2, "enforce"); // the only thing that changes
  for (const [i, a] of [c.claude, c.openai].entries()) {
    const v = await c.ask(a, "send_email", "send", `m-new-${i}`);
    assert.equal(v.status, "denied");
    assert.equal(v.reason, "policy_denied", "now refused outright, nobody is asked");
    assert.equal((await c.ask(a, "read_ticket", "read", `t-new-${i}`)).status, "approved", "what did not change still works");
  }
});

test("a central change is all or nothing: an unknown agent, a spending rule or a bad list changes no agent", async () => {
  const c = await setup();
  await setPolicyMany(c.db, [c.claude.id, c.openai.id], V1, "enforce");
  const before = [await c.version(c.claude.id), await c.version(c.openai.id)];
  assert.deepEqual(await refused(() => setPolicyMany(c.db, [c.claude.id, "agt_missing"], V2, "enforce")), { status: 404, code: "agent_not_found" });
  assert.deepEqual(await refused(() => setPolicyMany(c.db, [c.claude.id, c.openai.id], [{ tool: "pay_invoice", action: "execute", effect: "allow" }])), { status: 422, code: "spend_requires_approval" });
  assert.equal((await refused(() => setPolicyMany(c.db, [c.claude.id, c.openai.id], [{ tool: "x", action: "y", effect: "maybe" }]))).status, 422);
  for (const bad of [[], "agt", null, [c.claude.id, c.claude.id], [c.claude.id, 5], Array.from({ length: 51 }, (_, i) => `a${i}`)]) assert.deepEqual(await refused(() => setPolicyMany(c.db, bad, V1)), { status: 422, code: "invalid_agents" });
  assert.deepEqual([await c.version(c.claude.id), await c.version(c.openai.id)], before, "no version moved");
  assert.deepEqual(await c.stored(c.claude.id), V1);
  assert.deepEqual(await c.stored(c.openai.id), V1);
});

test("revoking one agent cancels only its own waiting request and leaves the other agent, its key and its policy alone", async () => {
  const c = await setup();
  await setPolicyMany(c.db, [c.claude.id, c.openai.id], V1, "enforce");
  const waitingClaude = await c.ask(c.claude, "send_email", "send", "m-1");
  const waitingOpenai = await c.ask(c.openai, "send_email", "send", "m-2");
  const policyBefore = await c.stored(c.openai.id), versionBefore = await c.version(c.openai.id);
  assert.equal((await revokeKey(c.db, c.claude.id, "operator-session-1")).revoked, true);
  assert.equal((await refused(() => c.as(c.claude))).status, 401, "the revoked key no longer works");
  assert.equal((await c.as(c.openai)).id, c.openai.id, "the other key still works");
  assert.equal((await c.ask(c.openai, "read_ticket", "read", "t-1")).status, "approved");
  assert.deepEqual(await c.stored(c.openai.id), policyBefore);
  assert.equal(await c.version(c.openai.id), versionBefore);
  const { projection } = await snapshot(c.db, OPERATOR);
  const status = (id: string) => projection.authorizations.find((a) => a.id === id)?.status;
  assert.equal(status(waitingClaude.id), "cancelled");
  assert.equal(status(waitingOpenai.id), "pending", "the other agent's waiting request is untouched");
});

test("one audit history holds both agents: their decisions and the policy changes that governed them", async () => {
  const c = await setup();
  await setPolicyMany(c.db, [c.claude.id, c.openai.id], V1, "enforce");
  for (const [i, a] of [c.claude, c.openai].entries()) { await c.ask(a, "read_ticket", "read", `t-${i}`); await c.ask(a, "delete_record", "delete", `r-${i}`); }
  const { projection } = await snapshot(c.db, OPERATOR);
  for (const id of [c.claude.id, c.openai.id]) {
    const types = projection.log.filter((l) => l.agentId === id).map((l) => l.type);
    for (const want of ["authorization_requested", "authorization_denied"]) assert.ok(types.includes(want as never), `${id}: ${want} (saw ${types.join(", ")})`);
    assert.ok(projection.authorizations.some((a) => a.agentId === id && a.status === "denied"), "the refusal is recorded for this agent");
  }
  const changes = (await since(c.db, OPERATOR, 0)).events.filter((e) => e.type === "policy.updated");
  assert.deepEqual(new Set(changes.map((e) => e.agentId)), new Set([c.claude.id, c.openai.id]), "and so are the policy changes that governed them");
});
