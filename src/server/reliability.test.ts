// Reliability cases that are not tested elsewhere in exactly this form (scripts/reliability.mjs lists every case and where it is tested).
import assert from "node:assert/strict";
import { test } from "node:test";
import { authAgent } from "./agent-auth.ts";
import { claimToken, consumeAuthorization, requestAuthorization } from "./authz.ts";
import { memoryDb } from "./db.ts";
import { decide, registerAgent, revokeKey, setPolicy } from "./repo.ts";

process.env.TEND_DEMO = "0";
const SEND = { tool: "send_note", action: "call", resource: "N-1" };
const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as { code?: string; extra?: { status?: string } }).extra?.status ?? (e as { code?: string }).code ?? String(e); } };

async function setup(rules = [{ tool: "send_note", action: "call", effect: "approve" }]) {
  const db = await memoryDb();
  const r = await registerAgent(db, { name: "A", model: "m", provider: "Custom" });
  await setPolicy(db, r.agent.id, rules, "enforce");
  const agent = (await authAgent(db, new Request("http://t/", { headers: { authorization: `Bearer ${r.apiKey}` } })))!;
  return { db, agent, id: r.agent.id };
}

test("the agent's own policy is tightened to never while a request waits: a later approval is refused, no token, nothing can run", async () => {
  const { db, agent, id } = await setup();
  const { view } = await requestAuthorization(db, agent, SEND, null);
  assert.equal(view.status, "pending");
  await setPolicy(db, id, [{ tool: "send_note", action: "call", effect: "deny" }], "enforce");
  const decided = await code(decide(db, view.id, "approved"));
  const claim = await code(claimToken(db, agent, view.id));
  assert.notEqual(claim, "ok", `the approval was ${decided}, and still no token is handed out`);
  assert.equal((await db.get<{ token_hash: string | null }>("SELECT token_hash FROM authorizations WHERE id = ?", view.id))!.token_hash, null);
  await db.close();
});

test("the key is revoked after the token was claimed but before it is spent: the consume is refused, nothing runs", async () => {
  const { db, agent, id } = await setup();
  const { view } = await requestAuthorization(db, agent, SEND, null);
  await decide(db, view.id, "approved");
  const t = (await claimToken(db, agent, view.id)).view as { token: string };
  await revokeKey(db, id);
  assert.notEqual(await code(consumeAuthorization(db, agent, view.id, { token: t.token, ...SEND })), "ok");
  assert.equal((await db.get<{ status: string }>("SELECT status FROM authorizations WHERE id = ?", view.id))!.status, "cancelled");
  await db.close();
});
