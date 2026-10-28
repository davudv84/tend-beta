// The Integrations page's status comes from real server records: sandbox setup, registered agents, their saved policy, and the
// gateway's own event log. These tests drive the real gateway and check the status follows, and that nothing sensitive is returned.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { claimToken } from "./authz.ts";
import { memoryDb } from "./db.ts";
import { executeTool, requestExecution } from "./gateway.ts";
import { integrationStatus } from "./integrations.ts";
import { decide, ingestEvents, registerAgent, setPolicy } from "./repo.ts";

const POLICY = [
  { tool: "read_test_file", action: "read", effect: "allow" },
  { tool: "write_test_file", action: "create", effect: "approve" },
  { tool: "delete_test_file", action: "delete", effect: "deny" },
];

test("status reflects missing configuration, registration, policy and real gateway activity, and returns no path or secret", async () => {
  const db = await memoryDb();
  const dir = mkdtempSync(path.join(tmpdir(), "tend-integrations-"));
  writeFileSync(path.join(dir, "hello.txt"), "hi\n");
  try {
    delete process.env.TEND_GATEWAY_SANDBOX_DIR;
    let s = await integrationStatus(db);
    assert.deepEqual(s.sandbox, { configured: false, usable: false });
    assert.ok(s.tools.every((t) => !t.available), "the file tools are not set up");
    assert.deepEqual(s.providers, { OpenAI: [], Anthropic: [] });

    process.env.TEND_GATEWAY_SANDBOX_DIR = path.join(dir, "missing");
    assert.deepEqual((await integrationStatus(db)).sandbox, { configured: true, usable: false }, "set but the folder is not there");

    process.env.TEND_GATEWAY_SANDBOX_DIR = dir;
    const { agent, apiKey } = await registerAgent(db, { name: "OpenAI test agent", model: "gpt-4.1-mini", provider: "OpenAI" });
    await registerAgent(db, { name: "Custom one", model: "m", provider: "Custom" });
    s = await integrationStatus(db);
    assert.deepEqual(s.sandbox, { configured: true, usable: true });
    assert.ok(s.tools.every((t) => t.available));
    assert.equal(s.providers.Anthropic.length, 0);
    const [a] = s.providers.OpenAI;
    assert.deepEqual([a.name, a.keyActive, a.lastSeenAt, a.seenRecently, a.policyAsRecommended], ["OpenAI test agent", true, null, false, false], "registered but nothing set up and never heard from");

    await setPolicy(db, agent.id, POLICY, "enforce");
    assert.equal((await integrationStatus(db)).providers.OpenAI[0].policyAsRecommended, true);

    // A real gateway read, then a real denied delete: the counts come from the event log.
    const { agentByKey } = await import("./repo.ts");
    const me = (await agentByKey(db, apiKey))!;
    const ok = (await requestExecution(db, me, { tool: "read_test_file", params: { path: "hello.txt" } }, null)).view;
    const { token } = (await claimToken(db, me, ok.id)).view as unknown as { token: string };
    await executeTool(db, me, { authorizationId: ok.id, token, tool: "read_test_file", params: { path: "hello.txt" } });
    await requestExecution(db, me, { tool: "delete_test_file", params: { path: "hello.txt" } }, null);
    await ingestEvents(db, me, [{ type: "agent.heartbeat" }]);
    const g = (await integrationStatus(db)).providers.OpenAI[0];
    assert.equal(g.gateway.successes, 1);
    assert.ok(g.gateway.last && g.seenRecently && g.lastSeenAt);
    assert.equal(g.policy.delete_test_file, "deny");

    // A changed policy is shown as different; a revoked key as inactive.
    await setPolicy(db, agent.id, [{ ...POLICY[0] }, { ...POLICY[1], effect: "allow" }, POLICY[2]], "enforce");
    assert.equal((await integrationStatus(db)).providers.OpenAI[0].policyAsRecommended, false);
    const { revokeKey } = await import("./repo.ts");
    await revokeKey(db, agent.id);
    assert.equal((await integrationStatus(db)).providers.OpenAI[0].keyActive, false);

    const wire = JSON.stringify(await integrationStatus(db));
    for (const secret of [dir, apiKey, token, "hello.txt"]) assert.equal(wire.includes(secret), false, "no path, key, token or file name in the status");
    void decide;
  } finally {
    delete process.env.TEND_GATEWAY_SANDBOX_DIR;
    rmSync(dir, { recursive: true, force: true });
    await db.close();
  }
});
