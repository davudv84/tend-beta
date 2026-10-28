import assert from "node:assert/strict";
import { test } from "node:test";
import { applyEvents, emptyProjection } from "../lib/projection.ts";
import { cancelAuthorization, claimToken, consumeAuthorization, MAX_PENDING, MISMATCH_LIMIT, requestAuthorization, TTL, authorizationStatus } from "./authz.ts";
import { hashKey } from "./auth.ts";
import { memoryDb } from "./db.ts";
import { HttpError } from "./http.ts";
import { control, decide, eventsAfter, inbox, ingestEvents, registerAgent, setPolicy } from "./repo.ts";
import { since, snapshot } from "./sync.ts";

const POLICY = [
  { tool: "send_payment", action: "execute", effect: "approve" },
  { tool: "read_document", action: "read", effect: "allow" },
  { tool: "wipe_disk", action: "*", effect: "deny" },
];
const PAY = { tool: "send_payment", action: "execute", resource: "INV-1", detail: "EUR 5.00 to Test GmbH" };
const READ = { tool: "read_document", action: "read", resource: "DOC-1" };
const TOKEN_SHAPE = /^tend_az_[A-Za-z0-9_-]{43}$/;

async function setup(policy: unknown = POLICY) {
  const db = await memoryDb();
  const mk = async (name: string) => {
    const { agent } = await registerAgent(db, { name, model: "m", provider: "Anthropic" });
    await db.run("UPDATE agents SET policy = ? WHERE id = ?", JSON.stringify(policy), agent.id);
    return agent;
  };
  return { db, agent: await mk("Probe"), other: await mk("Other") };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

const fails = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, code: e.code, extra: e.extra };
    throw e;
  }
  return assert.fail("expected the call to be refused");
};
const row = (db: Ctx["db"], id: string) => db.get<{ status: string; token_hash: string | null; mismatches: number; reason: string }>("SELECT * FROM authorizations WHERE id = ?", id);
const evs = async (db: Ctx["db"], type: string) => (await db.all<{ data: string }>("SELECT data FROM events WHERE type = ? ORDER BY seq", type)).map((r) => JSON.parse(r.data));

const tokenOf = async (db: Ctx["db"], agent: Ctx["agent"], id: string, now?: number) =>
  ((await claimToken(db, agent, id, now)).view as unknown as { token: string }).token;

/** Allowed by policy, claimed: ready to consume. */
async function ready({ db, agent }: Ctx, req: object = READ, now = Date.now()) {
  const { view } = await requestAuthorization(db, agent, req, null, now);
  assert.equal(view.status, "approved");
  return { id: view.id, token: await tokenOf(db, agent, view.id, now) };
}
/** Needs a human: requested, approved by an operator, claimed. */
async function approved(c: Ctx, req: object = PAY) {
  const { view } = await requestAuthorization(c.db, c.agent, req, null);
  assert.equal(view.status, "pending");
  await decide(c.db, view.id, "approved");
  return { id: view.id, token: await tokenOf(c.db, c.agent, view.id) };
}

test("an allowed action gets a token, spends it once, and the response says authorized, not executed", async () => {
  const c = await setup();
  const { id, token } = await ready(c);
  assert.match(token, TOKEN_SHAPE);
  const used = await consumeAuthorization(c.db, c.agent, id, { token, ...READ });
  assert.deepEqual(used, { authorized: true, authorizationId: id, ...READ });
  assert.equal((await row(c.db, id))!.status, "consumed");
  assert.equal((await evs(c.db, "authorization.consumed")).length, 1);
  assert.equal((await authorizationStatus(c.db, c.agent, id)).status, "consumed");
  await c.db.close();
});

test("with no matching rule, a deny rule or a broken policy the request is denied and no token can exist", async () => {
  for (const [policy, tool, reason] of [[[], "send_payment", "no_policy"], [POLICY, "wipe_disk", "policy_denied"], [POLICY, "unknown_tool", "no_policy"], ["garbage", "read_document", "invalid_policy"]] as const) {
    const c = await setup(policy);
    const { view, created } = await requestAuthorization(c.db, c.agent, { tool, action: "read" }, null);
    assert.deepEqual([view.status, view.reason, created], ["denied", reason, true]);
    assert.equal((await row(c.db, view.id))!.token_hash, null);
    assert.equal((await fails(() => claimToken(c.db, c.agent, view.id))).code, "not_approved");
    assert.equal((await fails(() => consumeAuthorization(c.db, c.agent, view.id, { token: `tend_az_${"A".repeat(43)}`, tool, action: "read" }))).code, "not_approved");
    assert.equal((await evs(c.db, "authorization.denied")).length, 1);
    await c.db.close();
  }
});

test("a sensitive action waits for a human; there is no token until it is approved", async () => {
  const c = await setup();
  const { view } = await requestAuthorization(c.db, c.agent, PAY, null);
  assert.equal(view.status, "pending");
  assert.equal((await claimToken(c.db, c.agent, view.id)).view.status, "pending");
  assert.equal((await row(c.db, view.id))!.token_hash, null);
  assert.equal((await fails(() => consumeAuthorization(c.db, c.agent, view.id, { token: `tend_az_${"A".repeat(43)}`, ...PAY }))).code, "not_approved");
  // The review queue entry is the authorization itself.
  assert.deepEqual(await c.db.get("SELECT id, status FROM reviews WHERE id = ?", view.id), { id: view.id, status: "pending" });
  await decide(c.db, view.id, "approved");
  const token = await tokenOf(c.db, c.agent, view.id);
  assert.equal((await consumeAuthorization(c.db, c.agent, view.id, { token, ...PAY })).authorized, true);
  await c.db.close();
});

test("a rejected request never gets a token, and cannot be decided again", async () => {
  const c = await setup();
  const { view } = await requestAuthorization(c.db, c.agent, PAY, null);
  await decide(c.db, view.id, "rejected");
  assert.equal((await row(c.db, view.id))!.status, "rejected");
  assert.equal((await fails(() => claimToken(c.db, c.agent, view.id))).code, "not_approved");
  assert.equal((await fails(() => consumeAuthorization(c.db, c.agent, view.id, { token: `tend_az_${"A".repeat(43)}`, ...PAY }))).code, "not_approved");
  assert.equal((await row(c.db, view.id))!.token_hash, null);
  assert.equal((await fails(() => decide(c.db, view.id, "approved"))).code, "already_decided");
  assert.equal((await row(c.db, view.id))!.status, "rejected");
  await c.db.close();
});

test("an expired request leaves the queue and a late approval is refused", async () => {
  const c = await setup();
  // Requested in 1970, so it is long past its 10 minutes.
  const { view } = await requestAuthorization(c.db, c.agent, PAY, null, 1_000_000);
  assert.equal((await fails(() => decide(c.db, view.id, "approved"))).status, 409);
  const r = await row(c.db, view.id);
  assert.deepEqual([r!.status, r!.token_hash], ["expired", null]);
  assert.equal((await c.db.get<{ status: string }>("SELECT status FROM reviews WHERE id = ?", view.id))!.status, "withdrawn");
  assert.equal((await evs(c.db, "authorization.expired")).length, 1);
  assert.equal((await fails(() => claimToken(c.db, c.agent, view.id))).code, "not_approved");
  await c.db.close();
});

test("a token is short-lived: it expires, re-claiming replaces it, and the old one is dead", async () => {
  const c = await setup();
  const t0 = Date.now();
  const { id, token: first } = await ready(c, READ, t0);
  const late = t0 + TTL.token + 1_000;
  const e = await fails(() => consumeAuthorization(c.db, c.agent, id, { token: first, ...READ }, late));
  assert.equal(e.code, "token_expired");
  assert.equal((await row(c.db, id))!.status, "approved"); // still usable with a fresh token
  const second = await tokenOf(c.db, c.agent, id, late);
  assert.notEqual(second, first);
  assert.equal((await fails(() => consumeAuthorization(c.db, c.agent, id, { token: first, ...READ }, late + 1))).code, "invalid_token");
  assert.equal((await consumeAuthorization(c.db, c.agent, id, { token: second, ...READ }, late + 2)).authorized, true);
  await c.db.close();
});

test("an approval nobody used in time expires, kills its token, and cannot be claimed again", async () => {
  const c = await setup();
  const t0 = Date.now();
  const { id, token } = await ready(c, READ, t0);
  const late = t0 + TTL.approval + 1_000;
  const e = await fails(() => consumeAuthorization(c.db, c.agent, id, { token, ...READ }, late));
  assert.deepEqual([e.code, e.extra], ["not_approved", { status: "expired" }]);
  const r = await row(c.db, id);
  assert.deepEqual([r!.status, r!.token_hash], ["expired", null]);
  assert.equal((await fails(() => claimToken(c.db, c.agent, id, late))).code, "not_approved");
  assert.equal((await fails(() => consumeAuthorization(c.db, c.agent, id, { token, ...READ }, t0 + 1))).code, "not_approved");
  await c.db.close();
});

test("a cancelled authorization cannot be approved, claimed or used", async () => {
  const c = await setup();
  const { view } = await requestAuthorization(c.db, c.agent, PAY, null);
  assert.equal((await cancelAuthorization(c.db, c.agent, view.id)).status, "cancelled");
  assert.equal((await c.db.get<{ status: string }>("SELECT status FROM reviews WHERE id = ?", view.id))!.status, "withdrawn");
  assert.equal((await fails(() => decide(c.db, view.id, "approved"))).code, "already_decided");
  assert.equal((await fails(() => claimToken(c.db, c.agent, view.id))).code, "not_approved");
  assert.equal((await cancelAuthorization(c.db, c.agent, view.id)).status, "cancelled"); // repeating is harmless

  const { id, token } = await ready(c);
  await cancelAuthorization(c.db, c.agent, id);
  assert.equal((await row(c.db, id))!.token_hash, null);
  assert.equal((await fails(() => consumeAuthorization(c.db, c.agent, id, { token, ...READ }))).code, "not_approved");

  const used = await ready(c);
  await consumeAuthorization(c.db, c.agent, used.id, { token: used.token, ...READ });
  assert.equal((await fails(() => cancelAuthorization(c.db, c.agent, used.id))).code, "not_cancellable");
  await c.db.close();
});

test("replay: a spent token fails, raises an alert, and a wrong token on a spent authorization does not", async () => {
  const c = await setup();
  const { id, token } = await ready(c);
  await consumeAuthorization(c.db, c.agent, id, { token, ...READ });
  const again = await fails(() => consumeAuthorization(c.db, c.agent, id, { token, ...READ }));
  assert.deepEqual([again.status, again.code], [409, "already_consumed"]);
  assert.equal((await fails(() => claimToken(c.db, c.agent, id))).code, "not_approved");
  assert.deepEqual((await evs(c.db, "alert.raised")).map((a) => [a.kind, a.reason]), [["authorization_replay", "replay"]]);
  assert.equal((await fails(() => consumeAuthorization(c.db, c.agent, id, { token: `tend_az_${"B".repeat(43)}`, ...READ }))).code, "invalid_token");
  assert.equal((await evs(c.db, "authorization.consumed")).length, 1);
  await c.db.close();
});

test("concurrent consumption: of ten simultaneous attempts exactly one wins", async () => {
  const c = await setup();
  const { id, token } = await ready(c);
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => consumeAuthorization(c.db, c.agent, id, { token, ...READ })));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  for (const r of results) if (r.status === "rejected") assert.equal((r.reason as HttpError).code, "already_consumed");
  assert.equal((await evs(c.db, "authorization.consumed")).length, 1);
  assert.equal((await evs(c.db, "alert.raised")).length, 9);
  await c.db.close();
});

test("concurrent human decisions: one wins and the authorization follows it", async () => {
  const c = await setup();
  const { view } = await requestAuthorization(c.db, c.agent, PAY, null);
  const results = await Promise.allSettled([decide(c.db, view.id, "approved"), decide(c.db, view.id, "rejected"), decide(c.db, view.id, "approved")]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const review = (await c.db.get<{ status: string }>("SELECT status FROM reviews WHERE id = ?", view.id))!.status;
  assert.equal((await row(c.db, view.id))!.status, review);
  await c.db.close();
});

test("mismatched execution: any changed field is refused, counted, alerted, and does not spend the approval", async () => {
  const c = await setup();
  const { id, token } = await approved(c);
  for (const other of [{ tool: "send_refund" }, { action: "create" }, { resource: "INV-2" }, { resource: undefined }, { detail: "EUR 9000.00 to Someone Else" }, { detail: undefined }]) {
    // The third mismatch revokes the authorization; after that it is simply not approved.
    const t = await fails(() => consumeAuthorization(c.db, c.agent, id, { token, ...PAY, ...other }));
    assert.equal(t.code === "mismatch" || t.code === "not_approved", true, JSON.stringify(other));
    if (t.code === "not_approved") break;
  }
  const r = (await row(c.db, id))!;
  assert.equal(r.status, "cancelled"); // revoked at the third mismatch
  assert.equal(r.token_hash, null);
  assert.equal(r.mismatches, 3);
  assert.equal((await evs(c.db, "alert.raised")).filter((a) => a.kind === "authorization_mismatch" && a.reason === "parameters_differ").length, 3);
  assert.equal((await fails(() => consumeAuthorization(c.db, c.agent, id, { token, ...PAY }))).code, "not_approved");

  // Below the limit the right call still works.
  const ok = await approved(c);
  await fails(() => consumeAuthorization(c.db, c.agent, ok.id, { token: ok.token, ...PAY, resource: "INV-2" }));
  await fails(() => consumeAuthorization(c.db, c.agent, ok.id, { token: ok.token, ...PAY, detail: "EUR 9000.00 to Someone Else" }));
  assert.equal((await consumeAuthorization(c.db, c.agent, ok.id, { token: ok.token, ...PAY })).authorized, true);
  await c.db.close();
});

test("a wrong or malformed token is refused, and the attempt is recorded even though the call fails", async () => {
  const c = await setup();
  const { id } = await ready(c);
  for (const token of [undefined, "", "x", "tend_az_short", 5, `tend_az_${"!".repeat(43)}`])
    assert.equal((await fails(() => consumeAuthorization(c.db, c.agent, id, { token, ...READ }))).code, "invalid_token");
  assert.equal((await evs(c.db, "alert.raised")).length, 0); // malformed: rejected before touching the row
  assert.equal((await fails(() => consumeAuthorization(c.db, c.agent, id, { token: `tend_az_${"C".repeat(43)}`, ...READ }))).code, "invalid_token");
  assert.deepEqual((await evs(c.db, "alert.raised")).map((a) => a.reason), ["invalid_token"]);
  assert.equal((await row(c.db, id))!.mismatches, 1);
  assert.equal((await row(c.db, id))!.status, "approved");
  await c.db.close();
});

test("a paused or disabled agent is refused at request, claim and consume; resuming restores it", async () => {
  const c = await setup();
  const { id, token } = await ready(c);
  await control(c.db, c.agent.id, "pause");
  assert.deepEqual([(await fails(() => claimToken(c.db, c.agent, id))).code, (await fails(() => consumeAuthorization(c.db, c.agent, id, { token, ...READ }))).extra], ["not_permitted", { reason: "agent_paused" }]);
  const denied = (await requestAuthorization(c.db, c.agent, READ, null)).view;
  assert.deepEqual([denied.status, denied.reason], ["denied", "agent_paused"]);
  await control(c.db, c.agent.id, "resume");
  assert.equal((await consumeAuthorization(c.db, c.agent, id, { token, ...READ })).authorized, true);

  await control(c.db, c.agent.id, "disable");
  assert.equal((await requestAuthorization(c.db, c.agent, READ, null)).view.reason, "integration_disabled");
  await c.db.close();
});

test("tightening the policy or breaking it takes effect on a token already issued", async () => {
  for (const [policy, reason] of [[[{ tool: "read_document", action: "read", effect: "deny" }], "policy_denied"], ["not json", "invalid_policy"], [[], "no_policy"]] as const) {
    const c = await setup();
    const { id, token } = await ready(c);
    await c.db.run("UPDATE agents SET policy = ? WHERE id = ?", typeof policy === "string" ? policy : JSON.stringify(policy), c.agent.id);
    assert.deepEqual((await fails(() => consumeAuthorization(c.db, c.agent, id, { token, ...READ }))).extra, { reason });
    assert.equal((await row(c.db, id))!.status, "approved"); // refused, not spent
    await c.db.close();
  }
});

test("tightening allow to approve stops an authorization no person approved, but not one a person did", async () => {
  const c = await setup([{ tool: "read_document", action: "read", effect: "allow" }, { tool: "send_payment", action: "execute", effect: "approve" }]);
  const auto = await ready(c);
  const human = await approved(c);
  await setPolicy(c.db, c.agent.id, [{ tool: "read_document", action: "read", effect: "approve" }, { tool: "send_payment", action: "execute", effect: "approve" }]);
  assert.deepEqual((await fails(() => claimToken(c.db, c.agent, auto.id))).extra, { reason: "approval_required" });
  assert.deepEqual((await fails(() => consumeAuthorization(c.db, c.agent, auto.id, { token: auto.token, ...READ }))).extra, { reason: "approval_required" });
  assert.equal((await consumeAuthorization(c.db, c.agent, human.id, { token: human.token, ...PAY })).authorized, true);
  await c.db.close();
});

test("an agent can neither see nor use another agent's authorization", async () => {
  const c = await setup();
  const { id, token } = await approved(c);
  const stranger = c.other;
  assert.equal((await fails(() => authorizationStatus(c.db, stranger, id))).code, "authorization_not_found");
  assert.equal((await fails(() => claimToken(c.db, stranger, id))).code, "authorization_not_found");
  assert.equal((await fails(() => cancelAuthorization(c.db, stranger, id))).code, "authorization_not_found");
  assert.equal((await fails(() => consumeAuthorization(c.db, stranger, id, { token, ...PAY }))).code, "authorization_not_found");
  assert.equal((await row(c.db, id))!.status, "approved");
  assert.equal((await consumeAuthorization(c.db, c.agent, id, { token, ...PAY })).authorized, true);
  await c.db.close();
});

test("requests are validated, repeated requests are idempotent, and the number waiting is capped", async () => {
  const c = await setup();
  for (const body of [null, [], "x", {}, { tool: "t" }, { tool: "send_payment", action: "execute", extra: 1 }, { ...PAY, detail: "x".repeat(201) }, { ...PAY, resource: "a b" }])
    assert.equal((await fails(() => requestAuthorization(c.db, c.agent, body, null))).code, "invalid_request", JSON.stringify(body));
  assert.equal((await fails(() => requestAuthorization(c.db, c.agent, PAY, "bad key"))).code, "invalid_idempotency_key");
  assert.equal((await fails(() => consumeAuthorization(c.db, c.agent, "x", [] as unknown))).code, "invalid_request");
  assert.equal((await fails(() => consumeAuthorization(c.db, c.agent, "az_none", { token: `tend_az_${"A".repeat(43)}`, ...PAY }))).code, "authorization_not_found");
  assert.equal((await fails(() => consumeAuthorization(c.db, c.agent, "az_none", { token: `tend_az_${"A".repeat(43)}` }))).code, "invalid_request");

  const first = await requestAuthorization(c.db, c.agent, PAY, "retry-1");
  const second = await requestAuthorization(c.db, c.agent, PAY, "retry-1");
  assert.deepEqual([first.created, second.created, second.view.id], [true, false, first.view.id]);
  assert.equal((await c.db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM reviews WHERE id = ?", first.view.id))!.n, 1);
  assert.equal((await fails(() => requestAuthorization(c.db, c.agent, { ...PAY, resource: "INV-9" }, "retry-1"))).code, "idempotency_conflict");

  for (let i = 1; i < MAX_PENDING; i++) await requestAuthorization(c.db, c.agent, PAY, null);
  assert.equal((await fails(() => requestAuthorization(c.db, c.agent, PAY, null))).status, 429);
  await c.db.close();
});

test("authorization requests can be approved or rejected but not merely acknowledged", async () => {
  const c = await setup();
  const { view } = await requestAuthorization(c.db, c.agent, PAY, null);
  assert.equal((await fails(() => decide(c.db, view.id, "acknowledged"))).code, "invalid_status");
  assert.equal((await row(c.db, view.id))!.status, "pending");
  await c.db.close();
});

test("tokens are stored only as hashes and never appear in events, responses or errors", async () => {
  const c = await setup();
  const { id, token } = await approved(c);
  const stored = (await row(c.db, id))!;
  assert.equal(stored.token_hash, hashKey(token));
  const wrong = `tend_az_${"D".repeat(43)}`;
  const e = (await fails(() => consumeAuthorization(c.db, c.agent, id, { token: wrong, ...PAY })));
  await consumeAuthorization(c.db, c.agent, id, { token, ...PAY });
  const dump = JSON.stringify([await c.db.all("SELECT * FROM events"), await c.db.all("SELECT * FROM authorizations"), await c.db.all("SELECT * FROM reviews"), await authorizationStatus(c.db, c.agent, id), e]);
  assert.equal(dump.includes(token) || dump.includes(wrong), false);
  // What an agent can read back has neither the token hash nor the fingerprint.
  assert.equal(Object.keys(await authorizationStatus(c.db, c.agent, id)).some((k) => /token|fingerprint/i.test(k)), false);
  await c.db.close();
});

test("setPolicy applies a valid policy at once, refuses an invalid one whole, and records the change", async () => {
  const c = await setup([]);
  const version = async () => (await c.db.get<{ config_version: number }>("SELECT config_version FROM agents WHERE id = ?", c.agent.id))!.config_version;
  assert.equal((await requestAuthorization(c.db, c.agent, READ, null)).view.status, "denied"); // nothing allowed yet
  const before = await version();
  const event = await setPolicy(c.db, c.agent.id, POLICY, "enforce");
  assert.deepEqual([event.type, event.actor, event.data.rules, event.data.enforcement], ["policy.updated", "human", 3, "enforce"]);
  assert.equal(await version(), before + 1);
  const saved = (await c.db.get<{ policy: string; enforcement: string }>("SELECT policy, enforcement FROM agents WHERE id = ?", c.agent.id))!;
  assert.deepEqual([JSON.parse(saved.policy), saved.enforcement], [POLICY, "enforce"]);
  assert.equal((await requestAuthorization(c.db, c.agent, READ, null)).view.status, "approved");

  for (const bad of [undefined, "x", {}, [{ tool: "t", action: "*", effect: "maybe" }], [POLICY[0], null]])
    assert.equal((await fails(() => setPolicy(c.db, c.agent.id, bad))).code, "invalid_policy");
  assert.equal((await fails(() => setPolicy(c.db, c.agent.id, POLICY, "off"))).code, "invalid_enforcement");
  assert.equal((await fails(() => setPolicy(c.db, "nobody", POLICY))).code, "agent_not_found");
  // Refused changes left the policy and version alone.
  assert.equal(await version(), before + 1);
  assert.deepEqual(JSON.parse((await c.db.get<{ policy: string }>("SELECT policy FROM agents WHERE id = ?", c.agent.id))!.policy), POLICY);
  await c.db.close();
});

// ---- What operators see, and execution reports checked against authorizations ----------------------

const OPERATOR = { role: "operator" as const, canAct: true, public: false, operatorAvailable: true, demo: false };
const report = (c: Ctx, data: object) => ingestEvents(c.db, c.agent, [{ type: "tool.called", data: { outcome: "success", ...data } }]).then((r) => r[0].alerts ?? []);

test("the dashboard projection shows every authorization status and logs each step once", async () => {
  const c = await setup();
  const t0 = Date.now();
  const used = await approved(c);
  await consumeAuthorization(c.db, c.agent, used.id, { token: used.token, ...PAY });
  const rejected = (await requestAuthorization(c.db, c.agent, { ...PAY, resource: "INV-2" }, null)).view.id;
  await decide(c.db, rejected, "rejected", "Not this one");
  const lapsed = (await requestAuthorization(c.db, c.agent, { ...PAY, resource: "INV-3" }, null, t0 - TTL.request - 1)).view.id;
  const denied = (await requestAuthorization(c.db, c.agent, { tool: "wipe_disk", action: "run" }, null)).view.id;
  const cancelled = (await requestAuthorization(c.db, c.agent, { ...PAY, resource: "INV-4" }, null)).view.id;
  await cancelAuthorization(c.db, c.agent, cancelled);
  const waiting = (await requestAuthorization(c.db, c.agent, { ...PAY, resource: "INV-5" }, null)).view.id;
  const allowed = await ready(c);
  // Wrong tokens, enough of them to revoke it.
  for (let i = 0; i < MISMATCH_LIMIT; i++) await fails(() => consumeAuthorization(c.db, c.agent, allowed.id, { token: `tend_az_${String(i).repeat(43)}`, ...READ }));

  // The snapshot itself sweeps the lapsed request, although nothing else has touched it.
  const { projection: p } = await snapshot(c.db, OPERATOR, t0);
  const status = Object.fromEntries(p.authorizations.map((a) => [a.id, a.status]));
  assert.deepEqual(status, { [used.id]: "consumed", [rejected]: "rejected", [lapsed]: "expired", [denied]: "denied", [cancelled]: "cancelled", [waiting]: "pending", [allowed.id]: "cancelled" });
  const az = (id: string) => p.authorizations.find((a) => a.id === id)!;
  assert.equal(az(rejected).note, "Not this one");
  assert.equal(az(allowed.id).reason, "revoked");
  assert.equal(az(allowed.id).alerts, MISMATCH_LIMIT);
  assert.deepEqual([az(waiting).detail, az(waiting).resource, az(waiting).expiresAt! > t0], [PAY.detail, "INV-5", true]);
  // Nothing an operator sees carries a token or its hash.
  assert.equal(/tend_az_|token/i.test(JSON.stringify(p.authorizations)), false);
  // Authorization requests are not shown a second time in the general review queue.
  assert.equal(p.requests.some((r) => p.authorizations.some((a) => a.id === r.id)), false);
  // One log entry per step; withdrawals are not repeated on top of expiry and cancellation.
  const types: string[] = p.log.map((l) => l.type);
  for (const t of ["authorization_requested", "authorization_approved", "authorization_rejected", "authorization_denied", "authorization_consumed", "authorization_expired", "authorization_cancelled", "authorization_mismatch"])
    assert.ok(types.includes(t), `log has ${t}`);
  assert.equal(types.includes("review_withdrawn"), false);
  assert.equal(types.filter((t) => t === "authorization_mismatch").length, MISMATCH_LIMIT);
  // Applying the events one batch at a time builds the same thing.
  const events = await eventsAfter(c.db, 0, 1000);
  let inc = emptyProjection(p.agents);
  for (const e of events) inc = applyEvents(inc, [e]);
  assert.deepEqual(inc.authorizations, p.authorizations);
  await c.db.close();
});

test("an execution report must match a consumed authorization exactly, and only once", async () => {
  const c = await setup();
  const { id, token } = await approved(c);
  // Reported as run before Tend authorized it.
  assert.deepEqual(await report(c, { ...PAY, authorizationId: id }), ["authorization_mismatch"]);
  await consumeAuthorization(c.db, c.agent, id, { token, ...PAY });
  assert.deepEqual(await report(c, { ...PAY, authorizationId: id }), []);
  // The same authorization reported for a second execution, even a failed one.
  assert.deepEqual(await report(c, { ...PAY, authorizationId: id, outcome: "failure" }), ["authorization_replay"]);
  // Spent on one thing, reported for another.
  const other = await approved(c, { ...PAY, resource: "INV-9" });
  await consumeAuthorization(c.db, c.agent, other.id, { token: other.token, ...PAY, resource: "INV-9" });
  assert.deepEqual(await report(c, { ...PAY, resource: "INV-9", detail: "EUR 5000.00 to Someone Else", authorizationId: other.id }), ["authorization_mismatch"]);
  // Unknown, or another agent's.
  const theirs = await ready({ ...c, agent: c.other });
  assert.deepEqual(await report(c, { ...READ, authorizationId: "az_doesnotexist" }), ["authorization_mismatch"]);
  assert.deepEqual(await report(c, { ...READ, authorizationId: theirs.id }), ["authorization_mismatch"]);
  // Not executions: a refused or cancelled call carrying an id raises nothing.
  assert.deepEqual(await report(c, { ...PAY, authorizationId: id, outcome: "cancelled" }), []);
  const reasons = (await evs(c.db, "alert.raised")).filter((a) => a.eventId).map((a) => [a.kind, a.reason]);
  assert.deepEqual(reasons, [
    ["authorization_mismatch", "not_consumed"], ["authorization_replay", "executed_twice"], ["authorization_mismatch", "execution_differs"],
    ["authorization_mismatch", "unknown_authorization"], ["authorization_mismatch", "unknown_authorization"],
  ]);
  // Shown to operators as not blocked: these ran.
  const { projection: p } = await snapshot(c.db, OPERATOR);
  const flagged = p.log.filter((l) => l.eventId && l.type.startsWith("authorization_"));
  assert.equal(flagged.length, 5);
  assert.ok(flagged.every((l) => l.args?.blocked === false));
  await c.db.close();
});

test("the operator snapshot carries authorization alerts under projection; a private instance refuses visitors with 401 and no data", async () => {
  const c = await setup();
  await setPolicy(c.db, c.agent.id, POLICY, "enforce");
  const { id, token } = await approved(c);
  await consumeAuthorization(c.db, c.agent, id, { token, ...PAY });
  await fails(() => consumeAuthorization(c.db, c.agent, id, { token, ...PAY }));
  await report(c, { ...PAY, authorizationId: id });
  await report(c, { ...PAY, authorizationId: id });
  await report(c, { ...PAY, resource: "INV-404" });
  const snap = await snapshot(c.db, OPERATOR);
  // The HTTP contract the dashboard (src/lib/store.ts) and scripts/authz-e2e.mjs read: nested, not flat.
  assert.deepEqual(Object.keys(snap).sort(), ["keys", "now", "projection", "seq", "viewer"]);
  const kinds = snap.projection.log.filter((l) => l.agentId === c.agent.id && l.args?.blocked !== undefined).map((l) => `${l.type}:${l.args!.reason}:${l.args!.blocked}`);
  assert.ok(kinds.includes("authorization_replay:replay:true"), kinds.join());
  assert.ok(kinds.includes("authorization_replay:executed_twice:false"), kinds.join());
  assert.ok(kinds.includes("unauthorized_execution:no_authorization:false"), kinds.join());
  assert.equal(snap.projection.authorizations.find((a) => a.id === id)?.status, "consumed");
  for (const v of [{ ...OPERATOR, role: "visitor" as const, canAct: false }, { ...OPERATOR, role: "visitor" as const, canAct: true }]) {
    assert.deepEqual(await fails(() => snapshot(c.db, v)), { status: 401, code: "sign_in_required", extra: undefined });
    assert.deepEqual(await fails(() => since(c.db, v, 0)), { status: 401, code: "sign_in_required", extra: undefined });
  }
  await c.db.close();
});

test("in enforce mode, running a policy-governed tool without an authorization is flagged; monitor mode and ungoverned calls are not", async () => {
  const c = await setup();
  const policy = [...POLICY, { tool: "lookup", action: "read", resourcePrefix: "SECRET-", effect: "deny" }];
  await setPolicy(c.db, c.agent.id, policy, "monitor");
  assert.equal((await inbox(c.db, c.agent)).config.enforcement, "monitor");
  assert.deepEqual(await report(c, PAY), []);
  await setPolicy(c.db, c.agent.id, policy, "enforce");
  assert.equal((await inbox(c.db, c.agent)).config.enforcement, "enforce");
  assert.deepEqual(await report(c, PAY), ["unauthorized_execution"]);
  assert.deepEqual(await report(c, { ...PAY, outcome: "failure" }), ["unauthorized_execution"]);
  assert.deepEqual(await report(c, { tool: "lookup", action: "read", resource: "SECRET-1" }), ["unauthorized_execution"]);
  // Not governed: a tool no rule names, or a resource outside the only rule's prefix.
  assert.deepEqual(await report(c, { tool: "create_task", action: "create", resource: "HR" }), []);
  assert.deepEqual(await report(c, { tool: "lookup", action: "read", resource: "PUBLIC-1" }), []);
  // Refused calls are not executions.
  assert.deepEqual(await report(c, { ...PAY, outcome: "denied" }), []);
  await c.db.close();
});
