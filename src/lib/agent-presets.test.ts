// The presets as TEND's real policy engine decides them. A change to a preset that loosens one of these fails here.
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate, parsePolicy } from "../server/policy.ts";
import { PRESETS, presetOf, presetRules } from "./agent-presets.ts";

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
