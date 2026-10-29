// Central policies: one rule set kept once and assigned to many agents (here a Claude agent and an OpenAI agent, different providers,
// different keys). Updating it governs every assigned agent at once; an agent's own rules can tighten a centrally governed tool but never
// loosen it; every change is audited; visitors see none of the rules; a broken central policy denies (fail closed).
import assert from "node:assert/strict";
import { test } from "node:test";
import { authAgent } from "./agent-auth.ts";
import { claimToken, requestAuthorization } from "./authz.ts";
import { memoryDb } from "./db.ts";
import { HttpError } from "./http.ts";
import { policyView } from "./permissions.ts";
import { evaluateEffective } from "./policy.ts";
import { forViewer } from "./redact.ts";
import { assignCentralPolicy, createCentralPolicy, decide, listCentralPolicies, registerAgent, revokeKey, setPolicy, updateCentralPolicy } from "./repo.ts";
import { since } from "./sync.ts";
import { runVerification } from "./verification.ts";

const OPERATOR = { role: "operator" as const, canAct: true, public: false, operatorAvailable: true, demo: false };
const VISITOR = { role: "visitor" as const, canAct: false, public: true, operatorAvailable: true, demo: false };
const V1 = [{ tool: "read_ticket", action: "read", effect: "allow" }, { tool: "send_email", action: "send", effect: "approve" }, { tool: "delete_record", action: "delete", effect: "deny" }];
const V2 = V1.map((r) => (r.tool === "send_email" ? { ...r, effect: "deny" } : r));

async function setup() {
  const db = await memoryDb();
  const mk = async (name: string, provider: string) => {
    const r = await registerAgent(db, { name, model: "m", provider });
    return { id: r.agent.id, key: r.apiKey };
  };
  const claude = await mk("Claude agent", "Anthropic"), openai = await mk("OpenAI agent", "OpenAI");
  const as = (a: { key: string }) => authAgent(db, new Request("http://localhost/api/v1/authorizations", { headers: { authorization: `Bearer ${a.key}` } }));
  let n = 0;
  const ask = async (a: { key: string }, tool: string, action: string, resource = `r-${n++}`) => (await requestAuthorization(db, await as(a), { tool, action, resource, detail: `${tool} ${resource}` }, null)).view;
  const version = async (id: string) => (await db.get<{ config_version: number }>("SELECT config_version FROM agents WHERE id = ?", id))!.config_version;
  const events = async (type: string) => (await since(db, OPERATOR, 0)).events.filter((e) => e.type === type);
  const central = await createCentralPolicy(db, { name: "Company baseline", rules: V1 }, "operator-session-1");
  return { db, claude, openai, as, ask, version, events, central };
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

test("a central policy is stored once, assigned explicitly to several agents, and each assignment is an audit event", async () => {
  const c = await setup();
  const before = [await c.version(c.claude.id), await c.version(c.openai.id)];
  const view = await assignCentralPolicy(c.db, c.central.id, { assign: [c.claude.id, c.openai.id] }, "operator-session-1");
  assert.deepEqual(view.agents.sort(), [c.claude.id, c.openai.id].sort());
  assert.deepEqual((await listCentralPolicies(c.db))[0].rules, V1);
  assert.deepEqual([await c.version(c.claude.id), await c.version(c.openai.id)], before.map((v) => v + 1), "each agent's configuration version moved");
  const assigned = await c.events("policy.central_assigned");
  assert.deepEqual(new Set(assigned.map((e) => e.agentId)), new Set([c.claude.id, c.openai.id]));
  for (const e of assigned) assert.deepEqual([e.data.policyId, e.data.policyVersion, e.data.by, e.data.policy], [c.central.id, 1, "operator-session-1", V1]);
  for (const [i, a] of [c.claude, c.openai].entries()) {
    assert.equal((await c.ask(a, "read_ticket", "read", `t-${i}`)).status, "approved");
    assert.equal((await c.ask(a, "send_email", "send", `m-${i}`)).status, "pending");
    assert.equal((await c.ask(a, "delete_record", "delete", `d-${i}`)).status, "denied");
  }
});

test("updating the central policy once changes every assigned agent, with no agent change, restart or new key", async () => {
  const c = await setup();
  await assignCentralPolicy(c.db, c.central.id, { assign: [c.claude.id, c.openai.id] });
  const updated = await updateCentralPolicy(c.db, c.central.id, { rules: V2, expectedVersion: 1 }, "operator-session-2");
  assert.equal(updated.version, 2);
  for (const a of [c.claude, c.openai]) {
    const v = await c.ask(a, "send_email", "send");
    assert.deepEqual([v.status, v.reason], ["denied", "policy_denied"], "refused outright now, nobody is asked");
    assert.equal((await c.ask(a, "read_ticket", "read")).status, "approved");
  }
  const changes = await c.events("policy.central_updated");
  assert.equal(changes.length, 2, "one audit event per assigned agent");
  for (const e of changes) assert.deepEqual([e.data.policyVersion, e.data.by, e.data.policy], [2, "operator-session-2", V2]);
  assert.deepEqual(await refused(() => updateCentralPolicy(c.db, c.central.id, { rules: V1, expectedVersion: 1 })), { status: 409, code: "policy_changed" }, "a stale editor cannot silently undo a change");
});

test("precedence: an agent's own rule can tighten a centrally governed tool but never loosen it; ungoverned tools follow the agent", () => {
  const ok = { status: "active" as const, integrationEnabled: true, permissions: [] };
  const req = (tool: string, action: string, resource: string | null = null) => ({ tool, action, resource, detail: null });
  const decide2 = (own: unknown, central: unknown, r: ReturnType<typeof req>) => evaluateEffective(ok, own, central, r);
  // loosening attempts: all fail
  assert.equal(decide2([{ tool: "send_email", action: "send", effect: "allow" }], V1, req("send_email", "send")).effect, "approve");
  assert.equal(decide2([{ tool: "delete_record", action: "*", effect: "allow" }], V1, req("delete_record", "delete")).effect, "deny");
  assert.equal(decide2([{ tool: "delete_record", action: "delete", resourcePrefix: "safe-", effect: "allow" }], V1, req("delete_record", "delete", "safe-1")).effect, "deny", "a more specific agent rule still cannot loosen");
  // tightening: works, and says it came from the agent
  assert.deepEqual(decide2([{ tool: "read_ticket", action: "read", effect: "deny" }], V1, req("read_ticket", "read")), { effect: "deny", reason: "policy_denied", source: "agent" });
  // central governs, agent silent: central decides
  assert.deepEqual(decide2([], V1, req("send_email", "send")), { effect: "approve", reason: "approval_required", source: "central" });
  // not governed centrally: the agent's own rules, as before
  assert.deepEqual(decide2([{ tool: "make_tea", action: "brew", effect: "allow" }], V1, req("make_tea", "brew")), { effect: "allow", reason: "policy_allowed", source: "agent" });
  assert.equal(decide2([], V1, req("make_tea", "brew")).reason, "no_policy");
  // spending is never automatic, whoever allows it
  assert.equal(decide2([], [{ tool: "pay_invoice", action: "execute", effect: "allow" }], req("pay_invoice", "execute")).effect, "approve");
  // broken policies deny
  assert.deepEqual(decide2([], "not json", req("read_ticket", "read")), { effect: "deny", reason: "invalid_policy", source: "central" });
  assert.equal(decide2("not json", V1, req("read_ticket", "read")).effect, "deny", "an unreadable own policy cannot be skipped for a governed tool either");
  assert.equal(decide2(V1, undefined, req("read_ticket", "read")).source, "agent", "no central policy: exactly the old behaviour");
});

test("an operator who sets a looser agent-specific policy does not weaken the central one, and the policy view shows what is really enforced", async () => {
  const c = await setup();
  const central = await createCentralPolicy(c.db, { name: "Gateway baseline", rules: [{ tool: "write_test_file", action: "create", effect: "deny" }] });
  await assignCentralPolicy(c.db, central.id, { assign: [c.openai.id] });
  await setPolicy(c.db, c.openai.id, [{ tool: "write_test_file", action: "create", effect: "allow" }, { tool: "read_test_file", action: "read", effect: "allow" }], "enforce");
  const view = await policyView(c.db, c.openai.id);
  const tool = (t: string) => view.tools.find((x) => x.tool === t)!;
  assert.deepEqual([tool("write_test_file").effect, tool("write_test_file").source], ["deny", "central"]);
  assert.deepEqual([tool("read_test_file").effect, tool("read_test_file").source], ["allow", "agent"]);
  assert.equal(view.central?.id, central.id);
  assert.equal((await c.ask(c.openai, "write_test_file", "create")).status, "denied");
});

test("tightening the central policy while a request waits or is approved stops it: no token, nothing runs", async () => {
  const c = await setup();
  await assignCentralPolicy(c.db, c.central.id, { assign: [c.claude.id] });
  const waiting = await c.ask(c.claude, "send_email", "send", "m-wait");
  const approved = await c.ask(c.claude, "send_email", "send", "m-ok");
  await decide(c.db, approved.id, "approved");
  const allowed = await c.ask(c.claude, "read_ticket", "read", "t-1");
  await updateCentralPolicy(c.db, c.central.id, { rules: V2.map((r) => (r.tool === "read_ticket" ? { ...r, effect: "approve" } : r)) });
  const agent = await c.as(c.claude);
  assert.deepEqual(await refused(() => claimToken(c.db, agent, approved.id)), { status: 403, code: "not_permitted" }, "an approval given under the old rules cannot be used");
  assert.deepEqual(await refused(() => claimToken(c.db, agent, allowed.id)), { status: 403, code: "not_permitted" }, "allowed by policy, now needs a person: the old grant stops");
  await decide(c.db, waiting.id, "approved");
  assert.deepEqual(await refused(() => claimToken(c.db, agent, waiting.id)), { status: 403, code: "not_permitted" }, "approving after the change does not override the new rules");
});

test("a central change is all or nothing, and every input is checked", async () => {
  const c = await setup();
  await assignCentralPolicy(c.db, c.central.id, { assign: [c.claude.id] });
  const before = await c.version(c.claude.id);
  assert.deepEqual(await refused(() => assignCentralPolicy(c.db, c.central.id, { assign: [c.openai.id, "agt_missing"] })), { status: 404, code: "agent_not_found" });
  assert.deepEqual((await listCentralPolicies(c.db))[0].agents, [c.claude.id], "the valid agent in the failed call was not assigned");
  assert.deepEqual(await refused(() => updateCentralPolicy(c.db, c.central.id, { rules: [{ tool: "pay_invoice", action: "execute", effect: "allow" }] })), { status: 422, code: "spend_requires_approval" });
  assert.equal((await refused(() => updateCentralPolicy(c.db, c.central.id, { rules: [{ tool: "x", action: "y", effect: "maybe" }] }))).status, 422);
  assert.equal(await c.version(c.claude.id), before, "refused changes moved nothing");
  assert.deepEqual(await refused(() => updateCentralPolicy(c.db, "cp_missing", { rules: V1 })), { status: 404, code: "central_policy_not_found" });
  assert.deepEqual(await refused(() => createCentralPolicy(c.db, { name: "Company baseline", rules: V1 })), { status: 409, code: "name_taken" });
  for (const name of ["", "x".repeat(65), "bad\u0007name", 5]) assert.equal((await refused(() => createCentralPolicy(c.db, { name, rules: V1 }))).code, "invalid_name");
  for (const body of [{}, { assign: "a" }, { assign: [c.claude.id, c.claude.id] }, { assign: [c.openai.id], unassign: [c.openai.id] }, { assign: Array.from({ length: 51 }, (_, i) => `a${i}`) }])
    assert.equal((await refused(() => assignCentralPolicy(c.db, c.central.id, body))).code, "invalid_agents");
  assert.deepEqual(await refused(() => assignCentralPolicy(c.db, c.central.id, { unassign: [c.openai.id] })), { status: 409, code: "not_assigned" });
});

test("unassigning returns an agent to its own rules, and is audited", async () => {
  const c = await setup();
  await setPolicy(c.db, c.claude.id, [{ tool: "send_email", action: "send", effect: "allow" }], "enforce");
  await assignCentralPolicy(c.db, c.central.id, { assign: [c.claude.id] });
  assert.equal((await c.ask(c.claude, "send_email", "send")).status, "pending", "central wins while assigned");
  await assignCentralPolicy(c.db, c.central.id, { unassign: [c.claude.id] }, "operator-session-3");
  assert.equal((await c.ask(c.claude, "send_email", "send")).status, "approved", "its own rule applies again");
  const [e] = await c.events("policy.central_unassigned");
  assert.deepEqual([e.agentId, e.data.policyId, e.data.by], [c.claude.id, c.central.id, "operator-session-3"]);
});

test("revoking one agent leaves the other agent, its key and the central policy alone; agents cannot touch each other's requests", async () => {
  const c = await setup();
  await assignCentralPolicy(c.db, c.central.id, { assign: [c.claude.id, c.openai.id] });
  const mine = await c.ask(c.claude, "send_email", "send");
  const theirs = await c.ask(c.openai, "send_email", "send");
  await decide(c.db, theirs.id, "approved");
  assert.deepEqual(await refused(async () => claimToken(c.db, await c.as(c.claude), theirs.id)), { status: 404, code: "authorization_not_found" }, "another agent's approval is invisible");
  await revokeKey(c.db, c.claude.id);
  assert.equal((await refused(() => c.as(c.claude))).status, 401);
  assert.equal((await c.as(c.openai)).id, c.openai.id);
  const claimed = (await claimToken(c.db, await c.as(c.openai), theirs.id)).view;
  assert.ok("token" in claimed && claimed.token, "the other agent's approved request still works");
  assert.deepEqual((await listCentralPolicies(c.db))[0].agents.sort(), [c.claude.id, c.openai.id].sort(), "the assignment is unchanged");
  const cancelled = new Map((await since(c.db, OPERATOR, 0)).events.filter((e) => e.type === "authorization.cancelled").map((e) => [e.data.authorizationId, e.agentId]));
  assert.equal(cancelled.get(mine.id), c.claude.id, "only the revoked agent's waiting request was cancelled");
  assert.equal(cancelled.has(theirs.id), false);
});

test("visitors never see a central policy's rules, name or who changed it", async () => {
  const c = await setup();
  await assignCentralPolicy(c.db, c.central.id, { assign: [c.claude.id] }, "operator-session-1");
  await updateCentralPolicy(c.db, c.central.id, { rules: V2 }, "operator-session-1");
  for (const type of ["policy.central_assigned", "policy.central_updated"]) {
    const [e] = await c.events(type);
    const shown = forViewer(e, VISITOR)!;
    assert.deepEqual(Object.keys(shown.data).sort(), ["policyVersion", "version"], type);
  }
});

test("an unreadable central policy denies every request of its agents, governed or not (fail closed)", async () => {
  const c = await setup();
  await setPolicy(c.db, c.claude.id, [{ tool: "make_tea", action: "brew", effect: "allow" }], "enforce");
  await assignCentralPolicy(c.db, c.central.id, { assign: [c.claude.id] });
  await c.db.run("UPDATE central_policies SET policy = 'not json' WHERE id = ?", c.central.id);
  for (const [tool, action] of [["read_ticket", "read"], ["make_tea", "brew"]]) {
    const v = await c.ask(c.claude, tool, action);
    assert.deepEqual([v.status, v.reason], ["denied", "invalid_policy"], tool);
  }
});

test("protection checks do not grade an agent that follows a central policy: they say not verified instead of overstating", async () => {
  const c = await setup();
  await setPolicy(c.db, c.claude.id, [], "enforce"); // its own rules mention nothing, so a copy of them alone would look like "everything refused"
  await assignCentralPolicy(c.db, c.central.id, { assign: [c.claude.id] });
  const run = await runVerification(c.db, c.claude.id, undefined, { notesDir: undefined });
  const isolated = run.checks.filter((x) => x.group === "isolated");
  assert.ok(isolated.length > 0);
  for (const x of isolated) assert.deepEqual([x.status, x.why], ["not_verified", "central_policy_assigned"], x.id);
});
