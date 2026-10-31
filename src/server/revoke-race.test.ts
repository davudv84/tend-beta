// From the security review of 2026-10-31: the key is looked up before the authorization transaction starts, so a request authenticated a
// moment before its key was revoked used to be authorized (and spent) a moment after. The transaction now checks the key again, under the lock.
import assert from "node:assert/strict";
import { test } from "node:test";
import { requestAuthorization, spendApproved } from "./authz.ts";
import { memoryDb } from "./db.ts";
import { agentByKey, decide, registerAgent, revokeKey, setPolicy } from "./repo.ts";

const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
process.env.TEND_DEMO = "0";

test("a key revoked between authentication and the transaction is refused: no new request, no spending an approval", async () => {
  const db = await memoryDb();
  const { agent, apiKey } = await registerAgent(db, { name: "Mailer", model: "m", provider: "Custom" });
  await setPolicy(db, agent.id, [{ tool: "read", action: "*", effect: "allow" }, { tool: "send_email", action: "*", effect: "approve" }], "enforce");
  const send = { tool: "send_email", action: "send", resource: "r1" };
  const before = (await agentByKey(db, apiKey))!;
  const { view } = await requestAuthorization(db, before, send, null);
  await decide(db, view.id, "approved");

  const authenticated = (await agentByKey(db, apiKey))!; // the route has checked the key...
  await revokeKey(db, agent.id); // ...and the revocation commits before its transaction runs
  assert.equal(await code(requestAuthorization(db, authenticated, { tool: "read", action: "run" }, null, Date.now(), { spend: true })), "invalid_key");
  assert.notEqual(await code(spendApproved(db, authenticated, view.id, send)), "ok", "an approval made before the revocation cannot be spent after it");
  assert.equal((await db.all("SELECT 1 FROM authorizations WHERE status = 'consumed'")).length, 0);
});
