import assert from "node:assert/strict";
import { test } from "node:test";
import { INTEGRATIONS, liveStatus, matches } from "./integrations-catalog.ts";

test("no integration is called working without evidence of a real connection; planned ones cannot be connected", () => {
  for (const i of INTEGRATIONS) {
    if (i.status === "verified") assert.ok(i.evidence && ["real-model", "real-protocol"].includes(i.evidence.kind), `${i.id}: "verified" needs real-connection evidence`);
    if (i.status === "compatible") assert.ok(i.evidence && ["protocol", "mocked"].includes(i.evidence.kind) && /No real/.test(i.evidence.test), `${i.id}: compatible must say what is not verified`);
    if (i.status === "planned") assert.ok(!i.connect && !i.evidence, `${i.id}: planned means nothing to connect or show`);
    if (i.evidence) assert.match(i.evidence.date, /^\d{4}-\d{2}-\d{2}$/);
  }
  assert.deepEqual(INTEGRATIONS.filter((i) => i.status === "verified").map((i) => i.id).sort(), ["claude", "http"], "only what was really verified");
  assert.equal(new Set(INTEGRATIONS.map((i) => i.id)).size, INTEGRATIONS.length);
});

test("live status counts only connected agents of that provider, and only actions TEND authorized and that succeeded", () => {
  const claude = INTEGRATIONS.find((i) => i.id === "claude")!;
  const agents = [{ id: "a", origin: "connected" as const, provider: "Anthropic" as const }, { id: "b", origin: "demo" as const, provider: "Anthropic" as const }, { id: "c", origin: "connected" as const, provider: "OpenAI" as const }];
  const ev = (agentId: string, at: number, extra: object) => ({ agentId, at, type: "tool.called" as const, ...extra });
  const events = [ev("a", 10, { outcome: "success", authorizationId: "az_1" }), ev("a", 50, { outcome: "denied" }), ev("a", 40, { outcome: "success" }), ev("b", 99, { outcome: "success", authorizationId: "az_2" }), ev("c", 98, { outcome: "success", authorizationId: "az_3" })];
  assert.deepEqual(liveStatus(claude, agents, events as never), { count: 1, lastVerifiedAt: 10 });
  assert.deepEqual(liveStatus(INTEGRATIONS.find((i) => i.id === "hermes")!, agents, events as never), { count: 0, lastVerifiedAt: null });
});

test("search matches the name, the summary or the category", () => {
  const mcp = INTEGRATIONS.find((i) => i.id === "mcp")!;
  assert.ok(matches(mcp, "Put TEND between an MCP host and a server", "host"));
  assert.ok(matches(mcp, "", "MCP"));
  assert.ok(matches(mcp, "", "protocol"));
  assert.ok(!matches(mcp, "", "gemini"));
  assert.ok(matches(mcp, "", "  "));
});
