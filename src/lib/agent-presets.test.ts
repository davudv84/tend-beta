// The presets as TEND's real policy engine decides them. A change to a preset that loosens one of these fails here.
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate, parsePolicy } from "../server/policy.ts";
import { coverageOf, isTestRule, PRESETS, presetOf, presetRules } from "./agent-presets.ts";

const agent = { status: "active" as const, integrationEnabled: true, permissions: [] };
const decide = (id: (typeof PRESETS)[number], tool: string, args: Record<string, string>) => evaluate(agent, presetRules(id), { tool, action: "Bash", resource: null, detail: null, args }).effect;

test("every preset is a valid policy and is recognised as itself", () => {
  for (const id of PRESETS) {
    assert.ok(parsePolicy(presetRules(id)).ok, id);
    assert.equal(presetOf([...presetRules(id)].reverse()), id);
  }
  assert.equal(presetOf([...presetRules("balanced"), { tool: "web", action: "*", effect: "allow" }]), null, "a different rule set is not the preset");
});

test("Balanced and Strict: what runs, what waits, what is refused", () => {
  const cases: [string, Record<string, string>, string, string][] = [
    ["shell", { command: "npm test" }, "allow", "approve"],
    ["shell", { command: "git push origin main" }, "approve", "approve"],
    ["shell", { command: "sudo rm x" }, "approve", "approve"],
    ["shell", { command: "cat ~/.ssh/id_rsa" }, "deny", "deny"],
    ["shell", { command: "rm -rf /" }, "deny", "deny"],
    ["file.read", { path: "/home/a/.ssh/id_rsa" }, "deny", "deny"],
    ["file.read", { path: "/home/a/project/.env" }, "approve", "allow"],
    ["file.write", { path: "/home/a/project/src/x.ts" }, "allow", "approve"],
    ["web", { url: "https://example.com" }, "approve", "approve"],
    ["mcp", { tool: "mcp__github__create_issue" }, "approve", "approve"],
    ["agent", {}, "allow", "allow"],
    ["unknown.kind", {}, "deny", "deny"],
  ];
  for (const [tool, args, balanced, strict] of cases) {
    assert.equal(decide("balanced", tool, args), balanced, `balanced ${tool} ${JSON.stringify(args)}`);
    assert.equal(decide("strict", tool, args), strict, `strict ${tool} ${JSON.stringify(args)}`);
  }
});

test("the test commands only ever make a command stricter, in every preset", () => {
  for (const id of PRESETS) {
    assert.equal(decide(id, "shell", { command: "echo tend-blocked-test" }), "deny", id);
    assert.equal(decide(id, "shell", { command: "echo tend-approval-test" }), "approve", id);
    assert.equal(decide(id, "shell", { command: "echo tend-approval-test && rm -rf ~" }), "approve", `${id}: a prefix gains nothing`);
    if (id !== "monitor") assert.equal(decide(id, "shell", { command: "echo tend-activity-test && sudo x" }), "approve", `${id}: there is no allow rule a prefix could use`);
  }
});

test("coverage: Balanced holds risky commands and web/MCP calls, records the rest, and leaves the test rules out", () => {
  const c = coverageOf(presetRules("balanced"));
  assert.ok(c.enforced.every((r) => r.effect !== "allow") && c.monitored.every((r) => r.effect === "allow"));
  assert.ok(c.enforced.some((r) => r.tool === "web" && r.effect === "approve" && !r.when));
  assert.ok(c.enforced.some((r) => r.tool === "shell" && r.effect === "deny" && (r.when as { command?: { contains?: string } }).command?.contains === ".ssh/"));
  assert.equal(c.enforced[0].effect, "deny", "blocks are listed first");
  assert.ok(!c.enforced.some(isTestRule) && !c.monitored.some(isTestRule));
  assert.deepEqual(c.unruled, []);
});

test("coverage: Monitor only enforces nothing, and a kind without a catch-all rule falls to the default block", () => {
  assert.deepEqual(coverageOf(presetRules("monitor")).enforced, []);
  const c = coverageOf([{ tool: "shell", action: "*", effect: "allow" }]);
  assert.deepEqual(c.unruled, ["file.write", "file.read", "web", "mcp", "agent"]);
});

test("coverage: a central policy's rules count too, marked as central, and a kind either policy catches is not left to the default", () => {
  const c = coverageOf([{ tool: "shell", action: "*", effect: "allow" }], [{ tool: "web", action: "*", effect: "deny" }, { tool: "shell", action: "*", effect: "approve", when: { command: { contains: "deploy" } } }]);
  assert.deepEqual(c.enforced.map((r) => [r.tool, r.effect, r.from]), [["web", "deny", "central"], ["shell", "approve", "central"]]);
  assert.deepEqual(c.monitored.map((r) => [r.tool, r.from]), [["shell", "agent"]]);
  assert.deepEqual(c.unruled, ["file.write", "file.read", "mcp", "agent"]);
});

test("coverage: a rule overridden by a stricter one with the same scope (from either policy) is not listed", () => {
  const c = coverageOf([{ tool: "mcp", action: "*", effect: "approve" }, { tool: "web", action: "*", effect: "allow" }], [{ tool: "mcp", action: "*", effect: "deny" }, { tool: "web", action: "*", effect: "approve" }]);
  assert.deepEqual(c.enforced.map((r) => [r.tool, r.effect, r.from]), [["mcp", "deny", "central"], ["web", "approve", "central"]]);
  assert.deepEqual(c.monitored, []);
});
