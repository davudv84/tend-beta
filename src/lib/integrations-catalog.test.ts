import assert from "node:assert/strict";
import { test } from "node:test";
import { BRAND_ICONS } from "./brand-icons.ts";
import { INTEGRATIONS, SCENARIOS, liveStatus, matches, shownStatus, statusOf, verificationOf, type Integration } from "./integrations-catalog.ts";

const PASS_ALL = SCENARIOS.map((scenario) => ({ scenario, verdict: "PASS" as const }));
const entry = (over: Partial<Integration> = {}): Integration => ({ id: "claude", name: "x", category: "provider", connect: "claude", ...over });

test("verified comes only from a report in which every scenario passed; nothing else can produce it", () => {
  const r = (v: object) => ({ claude: { label: "x", ...v } }) as never;
  assert.equal(statusOf(entry(), r({ status: "verified", scenarios: PASS_ALL })), "verified");
  assert.equal(statusOf(entry(), r({ status: "verified", scenarios: PASS_ALL.slice(0, 6) })), "compatible", "the audit scenario missing");
  assert.equal(statusOf(entry(), r({ status: "verified", scenarios: PASS_ALL.map((x) => (x.scenario === "revoke" ? { ...x, verdict: "INCONCLUSIVE" } : x)) })), "compatible");
  assert.equal(statusOf(entry(), r({ status: "failed", scenarios: PASS_ALL })), "compatible");
  assert.equal(statusOf(entry(), r({ status: "blocked", missing: ["KEY"] })), "blocked");
  assert.equal(statusOf(entry(), {} as never), "compatible", "implemented, never run");
  assert.equal(statusOf(entry({ connect: undefined }), r({ status: "verified", scenarios: PASS_ALL })), "planned", "not implemented: never verified");
  assert.equal(shownStatus(entry(), 2, r({ status: "failed" })), "connected");
  assert.equal(shownStatus(entry(), 2, r({ status: "verified", scenarios: PASS_ALL })), "verified");
  assert.equal(shownStatus(entry({ connect: undefined }), 2, {} as never), "planned");
});

test("the committed report and the catalog agree: every verified entry has a date and all seven passes; only Aider is not implemented", () => {
  for (const i of INTEGRATIONS) {
    const v = verificationOf(i);
    if (statusOf(i) === "verified") assert.ok(v?.verifiedAt && /^\d{4}-\d{2}-\d{2}T/.test(v.verifiedAt) && v.label, `${i.id}: verified needs a date and what was tested`);
    if (v?.status === "blocked") assert.ok(v.missing?.length, `${i.id}: blocked must say what is missing`);
  }
  assert.deepEqual(INTEGRATIONS.filter((i) => !i.connect).map((i) => i.id), ["aider"]);
  assert.equal(new Set(INTEGRATIONS.map((i) => i.id)).size, INTEGRATIONS.length);
});

test("logos are official marks only, never a stand-in: each one names the product it is shown for", () => {
  for (const i of INTEGRATIONS.filter((x) => x.logo)) {
    const mark = BRAND_ICONS[i.logo!];
    assert.ok(mark && /^[Mm]/.test(mark.path) && mark.source.startsWith("https://"), `${i.id}: mark data and its source`);
    // "Anthropic" for Anthropic, "Mistral AI" for Mistral AI, "Model Context Protocol" for it: the mark is the product's own.
    assert.equal(mark.title.toLowerCase().replace(/\W/g, ""), i.name.toLowerCase().replace(/\W/g, ""), `${i.id} shows ${mark.title}`);
  }
  // Parcel-company "Hermes" is not Hermes Agent; brands without an official mark in the set get the neutral fallback.
  for (const id of ["hermes", "openai", "openaiApi", "groq", "openclaw", "aider", "autogen", "mastra", "pydanticAi", "http", "openaiCompatible"]) assert.equal(INTEGRATIONS.find((i) => i.id === id)?.logo, undefined, id);
});

test("live status counts only connected agents of that provider, and only actions TEND authorized and that succeeded", () => {
  const claude = INTEGRATIONS.find((i) => i.id === "claude")!;
  const agents = [{ id: "a", origin: "connected" as const, provider: "Anthropic" as const }, { id: "b", origin: "demo" as const, provider: "Anthropic" as const }, { id: "c", origin: "connected" as const, provider: "OpenAI" as const }];
  const ev = (agentId: string, at: number, extra: object) => ({ agentId, at, type: "tool.called" as const, ...extra });
  const events = [ev("a", 10, { outcome: "success", authorizationId: "az_1" }), ev("a", 50, { outcome: "denied" }), ev("a", 40, { outcome: "success" }), ev("b", 99, { outcome: "success", authorizationId: "az_2" }), ev("c", 98, { outcome: "success", authorizationId: "az_3" })];
  assert.deepEqual(liveStatus(claude, agents, events as never), { count: 1, lastVerifiedAt: 10, shared: false });
  assert.equal(liveStatus(INTEGRATIONS.find((i) => i.id === "langchain")!, agents, events as never).shared, true, "LangChain agents register as Anthropic too");
  assert.deepEqual(liveStatus(INTEGRATIONS.find((i) => i.id === "aider")!, agents, events as never), { count: 0, lastVerifiedAt: null, shared: true });
});

test("search matches the name, the summary or the category", () => {
  const mcp = INTEGRATIONS.find((i) => i.id === "mcp")!;
  assert.ok(matches(mcp, "Put TEND between an MCP host and a server", "host"));
  assert.ok(matches(mcp, "", "MCP"));
  assert.ok(matches(mcp, "", "protocol"));
  assert.ok(!matches(mcp, "", "gemini"));
  assert.ok(matches(mcp, "", "  "));
});
