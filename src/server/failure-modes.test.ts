// Failure modes that must end in "not done": an unexpected server error, a database that goes away, two operators editing one central
// policy at once, an approval that ran out of time, and a spent approval used again, with a central policy in force.
// (Gateway unreachable, invalid and revoked keys are covered in examples/claude-agent/gate.test.mjs, agent-keys.test.ts and real-agents.test.ts.)
import assert from "node:assert/strict";
import { test } from "node:test";
import { claimToken, consumeAuthorization, requestAuthorization, TTL } from "./authz.ts";
import { memoryDb } from "./db.ts";
import { HttpError, route } from "./http.ts";
import { assignCentralPolicy, createCentralPolicy, decide, getAgent, listCentralPolicies, registerAgent, updateCentralPolicy } from "./repo.ts";
import { since } from "./sync.ts";

const OPERATOR = { role: "operator" as const, canAct: true, public: false, operatorAvailable: true, demo: false };
const RULES = [{ tool: "send_email", action: "send", effect: "approve" }, { tool: "read_ticket", action: "read", effect: "allow" }];

async function setup() {
  const db = await memoryDb();
  const reg = await registerAgent(db, { name: "Claude agent", model: "m", provider: "Anthropic" });
  const central = await createCentralPolicy(db, { name: "Baseline", rules: RULES });
  await assignCentralPolicy(db, central.id, { assign: [reg.agent.id] });
  const agent = (await getAgent(db, reg.agent.id))!;
  return { db, agent, central };
}
const refused = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, code: e.code, extra: e.extra };
    throw e;
  }
  return assert.fail("expected the call to be refused");
};

test("an unexpected server error answers 500 with a generic message: no stack, no SQL, no connection string", async () => {
  const quiet = console.error;
  console.error = () => {};
  try {
    // The fake connection string is built at run time, so no secret-shaped literal sits in the source.
    const leak = `connect ECONNREFUSED ${["postgres://tend", "s3cret@db.internal:5432/tend"].join(":")} at Pool.query`;
    const handler = route(async () => { throw new Error(leak); });
    const res = await handler(new Request("http://localhost/api/v1/authorizations", { method: "POST" }), {});
    assert.equal(res.status, 500);
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), { error: "internal_error", message: "Something went wrong on the server." });
    assert.ok(!/s3cret|postgres|ECONNREFUSED|Pool/.test(text));
  } finally {
    console.error = quiet;
  }
});

test("a database that goes away: requests, token claims and consumes all fail; no grant is ever handed out", async () => {
  const { db, agent } = await setup();
  const asked = (await requestAuthorization(db, agent, { tool: "send_email", action: "send", resource: "m-1", detail: "hi" }, null)).view;
  await decide(db, asked.id, "approved");
  await db.close();
  await assert.rejects(() => requestAuthorization(db, agent, { tool: "read_ticket", action: "read", resource: "t-1" }, null), "a new request cannot be approved without the database");
  await assert.rejects(() => claimToken(db, agent, asked.id), "an approved request cannot be claimed without the database");
  await assert.rejects(() => consumeAuthorization(db, agent, asked.id, { token: `tend_az_${"x".repeat(43)}`, tool: "send_email", action: "send", resource: "m-1", detail: "hi" }));
});

test("two operators changing one central policy from the same version at once: one wins, the other is told; nothing is mixed", async () => {
  const { db, central } = await setup();
  const results = await Promise.allSettled([
    updateCentralPolicy(db, central.id, { rules: [{ tool: "send_email", action: "send", effect: "deny" }], expectedVersion: 1 }, "operator-a"),
    updateCentralPolicy(db, central.id, { rules: [{ tool: "send_email", action: "send", effect: "allow" }], expectedVersion: 1 }, "operator-b"),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
  assert.ok(lost.reason instanceof HttpError && lost.reason.code === "policy_changed");
  const [now] = await listCentralPolicies(db);
  assert.equal(now.version, 2);
  const changes = (await since(db, OPERATOR, 0)).events.filter((e) => e.type === "policy.central_updated");
  assert.equal(changes.length, 1, "exactly one change was recorded");
  assert.deepEqual(changes[0].data.policy, now.rules, "and it is the one in force");
});

test("an approval nobody used in time cannot be claimed, even under a central policy", async () => {
  const { db, agent } = await setup();
  const t0 = Date.now();
  const asked = (await requestAuthorization(db, agent, { tool: "send_email", action: "send", resource: "m-2", detail: "late" }, null, t0)).view;
  await decide(db, asked.id, "approved");
  const late = await refused(() => claimToken(db, agent, asked.id, Date.now() + TTL.approval + 1000));
  assert.equal(late.status, 403);
  assert.equal(late.extra?.status, "expired");
});

test("a spent approval cannot be used again, even under a central policy", async () => {
  const { db, agent } = await setup();
  const body = { tool: "read_ticket", action: "read", resource: "t-9" };
  const asked = (await requestAuthorization(db, agent, body, null)).view;
  const claimed = (await claimToken(db, agent, asked.id)).view;
  assert.ok("token" in claimed);
  await consumeAuthorization(db, agent, asked.id, { token: claimed.token, ...body });
  const again = await refused(() => consumeAuthorization(db, agent, asked.id, { token: claimed.token, ...body }));
  assert.deepEqual([again.status, again.code], [409, "already_consumed"]);
});
