// The presets as TEND's real policy engine decides them. A change to a preset that loosens one of these fails here.
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate, parsePolicy } from "../server/policy.ts";
import { readFileSync } from "node:fs";
import { de } from "../i18n/de.ts";
import { en } from "../i18n/en.ts";
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
    ["file.read", { path: "/home/a/.ssh" }, "deny", "deny"], // a search rooted at the folder itself (review of 2026-10-31)
    ["shell", { command: "ls ~/.ssh" }, "deny", "deny"],
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
  assert.ok(c.enforced.some((r) => r.tool === "shell" && r.effect === "deny" && (r.when as { command?: { contains?: string } }).command?.contains === ".ssh"));
  assert.equal(c.enforced[0].effect, "deny", "blocks are listed first");
  assert.ok(!c.enforced.some(isTestRule) && !c.monitored.some(isTestRule));
  assert.deepEqual(c.unruled, []);
});

test("coverage: Monitor only enforces nothing, and a kind without a catch-all rule falls to the default block", () => {
  assert.deepEqual(coverageOf(presetRules("monitor")).enforced, []);
  const c = coverageOf([{ tool: "shell", action: "*", effect: "allow" }]);
  assert.deepEqual(c.unruled, ["file.write", "file.read", "web", "mcp", "agent", "other"]);
});

test("coverage: a central policy's rules count too, marked as central, and a kind either policy catches is not left to the default", () => {
  const c = coverageOf([{ tool: "shell", action: "*", effect: "allow" }], [{ tool: "web", action: "*", effect: "deny" }, { tool: "shell", action: "*", effect: "approve", when: { command: { contains: "deploy" } } }]);
  assert.deepEqual(c.enforced.map((r) => [r.tool, r.effect, r.from]), [["web", "deny", "central"], ["shell", "approve", "central"]]);
  assert.deepEqual(c.monitored.map((r) => [r.tool, r.from]), [["shell", "agent"]]);
  assert.deepEqual(c.unruled, ["file.write", "file.read", "mcp", "agent", "other"]);
});

test("coverage: a rule overridden by a stricter one with the same scope (from either policy) is not listed", () => {
  const c = coverageOf([{ tool: "mcp", action: "*", effect: "approve" }, { tool: "web", action: "*", effect: "allow" }], [{ tool: "mcp", action: "*", effect: "deny" }, { tool: "web", action: "*", effect: "approve" }]);
  assert.deepEqual(c.enforced.map((r) => [r.tool, r.effect, r.from]), [["mcp", "deny", "central"], ["web", "approve", "central"]]);
  assert.deepEqual(c.monitored, []);
});

// ---- What the presets promise against a reworded command (security review, Nov 2026) ----------------------------------------------------------
// The shell rules match the text of a command. These cases are written to get past that text match. They pin two facts: Strict never lets any of
// them run without a person, and Balanced is a tripwire, not a boundary (docs/security-limitations.md says so). If Balanced is ever hardened so
// that some of these are caught, move them to the first list; never weaken the Strict assertion.
const REWORDED = [
  ["read an SSH key through a glob", "cat ~/.ss?/id_rsa"],
  ["read an SSH key through split quotes", "cat ~/.s''sh/id_rsa"],
  ["read an SSH key through a variable", "d=.ss; cat ~/${d}h/id_rsa"],
  ["read an SSH key through base64", "cat $(echo fi5zc2gvaWRfcnNh | base64 -d)"],
  ["push with git -C", "git -C . push origin main"],
  ["push through sh -c", "sh -c 'git pu''sh origin main'"],
  ["delete with find", "find build -delete"],
  ["reach the network from python", `python3 -c "import urllib.request as u;u.urlopen('https://example.com')"`],
  ["reach the network from node", `node -e "fetch('https://example.com')"`],
  ["escalate with su", "su -c ls root"],
] as const;
const shellRequest = (command: string) => ({ tool: "shell", action: "Bash", resource: null, detail: `Run: ${command}`.slice(0, 200), args: { command } });
const AGENT = { status: "active" as const, integrationEnabled: true, permissions: [] as string[] };

test("Strict: no shell command, however it is worded, runs without a person", () => {
  for (const [what, command] of REWORDED) {
    const d = evaluate(AGENT, presetRules("strict"), shellRequest(command));
    assert.notEqual(d.effect, "allow", `strict let "${what}" run on its own`);
  }
  for (const command of ["ls", "echo hi", "npm test", "git status"]) assert.notEqual(evaluate(AGENT, presetRules("strict"), shellRequest(command)).effect, "allow");
});

test("Balanced is a text tripwire: the plain forms are held, reworded forms get past it (documented limitation)", () => {
  for (const command of ["git push origin main", "rm -rf build", "curl https://example.com", "sudo ls"]) assert.equal(evaluate(AGENT, presetRules("balanced"), shellRequest(command)).effect, "approve", command);
  assert.equal(evaluate(AGENT, presetRules("balanced"), shellRequest("cat ~/.ssh/id_rsa")).effect, "deny");
  const through = REWORDED.filter(([, c]) => evaluate(AGENT, presetRules("balanced"), shellRequest(c)).effect === "allow").map(([w]) => w);
  assert.deepEqual(through, REWORDED.map(([w]) => w), "if Balanced now catches some of these, update this test and docs/security-limitations.md");
  const doc = readFileSync(new URL("../../docs/security-limitations.md", import.meta.url), "utf8");
  assert.match(doc, /presets match the words of a command/, "the limitation is written down where operators read it");
});

test("the Balanced description does not promise more than a text match", () => {
  for (const dict of [en, de]) assert.match(dict.assistant.presets.balanced.body, /reworded|umformuliert/);
});
