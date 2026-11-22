// The website says "Everything starts blocked. It can do only what you allow." (setup steps, connect guide). This pins what that means: an agent
// that has just been created, with no rules, is refused every action it asks TEND to authorize. (Its enforcement mode is "monitor": that only
// governs how an execution reported WITHOUT an authorization is flagged. TEND can only control what goes through TEND, and the site says so.)
import assert from "node:assert/strict";
import { test } from "node:test";
import { authAgent } from "./agent-auth.ts";
import { requestAuthorization } from "./authz.ts";
import { memoryDb } from "./db.ts";
import { registerAgent, setPolicy } from "./repo.ts";

process.env.TEND_ADMIN_TOKEN = "fake_admin_default_blocked_test";
process.env.TEND_DEMO = "0";

test("a new agent with no rules is denied every action it asks for; only a rule changes that", async () => {
  const db = await memoryDb();
  const reg = await registerAgent(db, { name: "Fresh", model: "m", provider: "Custom" });
  const agent = (await authAgent(db, new Request("http://t/api", { headers: { authorization: `Bearer ${reg.apiKey}` } })))!;
  for (const req of [{ tool: "send_email", action: "send" }, { tool: "delete_records", action: "call" }, { tool: "read_file", action: "read" }]) {
    assert.equal((await requestAuthorization(db, agent, req, null)).view.status, "denied", `${req.tool} is blocked by default`);
  }
  await setPolicy(db, reg.agent.id, [{ tool: "send_email", action: "send", effect: "approve" }], "enforce");
  assert.equal((await requestAuthorization(db, agent, { tool: "send_email", action: "send" }, null)).view.status, "pending", "a rule makes it ask a person");
  assert.equal((await requestAuthorization(db, agent, { tool: "delete_records", action: "call" }, null)).view.status, "denied", "everything else stays blocked");
});
