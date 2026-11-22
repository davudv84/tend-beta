// The presets as TEND's real policy engine decides them. A change to a preset that loosens one of these fails here.
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate, parsePolicy } from "../server/policy.ts";
import { readFileSync } from "node:fs";
import { de } from "../i18n/de.ts";
import { en } from "../i18n/en.ts";
import { coverageOf, isTestRule, LATEST, PRESET_VERSIONS, PRESETS, presetOf, presetRules, presetVersionOf } from "./agent-presets.ts";

const agent = { status: "active" as const, integrationEnabled: true, permissions: [] };
const decide = (id: (typeof PRESETS)[number], tool: string, args: Record<string, string>, version?: number) => evaluate(agent, presetRules(id, version), { tool, action: "Bash", resource: null, detail: null, args }).effect;

test("every version of every preset is a valid policy and is recognised as itself, with its version", () => {
  for (const id of PRESETS)
    for (const v of PRESET_VERSIONS[id]) {
      assert.ok(parsePolicy(presetRules(id, v)).ok, `${id} v${v}`);
      assert.equal(presetOf([...presetRules(id, v)].reverse()), id, `${id} v${v}: an older saved version is still recognised, never mislabelled`);
      assert.deepEqual(presetVersionOf(presetRules(id, v)), { id, version: v, latest: v === LATEST[id] });
    }
  assert.deepEqual(presetRules("balanced"), presetRules("balanced", LATEST.balanced), "without a version, the latest is saved");
  assert.throws(() => presetRules("balanced", 99));
  assert.equal(presetOf([...presetRules("balanced"), { tool: "web", action: "*", effect: "allow" }]), null, "a different rule set is not the preset");
});

test("Balanced and Strict v1 (kept for saved policies): what runs, what waits, what is refused", () => {
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
    assert.equal(decide("balanced", tool, args, 1), balanced, `balanced v1 ${tool} ${JSON.stringify(args)}`);
    assert.equal(decide("strict", tool, args, 1), strict, `strict v1 ${tool} ${JSON.stringify(args)}`);
  }
});

test("the test commands only ever make a command stricter, in every version of every preset", () => {
  for (const id of PRESETS) for (const v of PRESET_VERSIONS[id]) {
    const decide = (_: unknown, tool: string, args: Record<string, string>) => evaluate(agent, presetRules(id, v), { tool, action: "Bash", resource: null, detail: null, args }).effect;
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

test("Balanced v1 is a text tripwire: the plain forms are held, reworded forms get past it (documented; kept only for saved policies)", () => {
  for (const command of ["git push origin main", "rm -rf build", "curl https://example.com", "sudo ls"]) assert.equal(evaluate(AGENT, presetRules("balanced", 1), shellRequest(command)).effect, "approve", command);
  assert.equal(evaluate(AGENT, presetRules("balanced", 1), shellRequest("cat ~/.ssh/id_rsa")).effect, "deny");
  const through = REWORDED.filter(([, c]) => evaluate(AGENT, presetRules("balanced", 1), shellRequest(c)).effect === "allow").map(([w]) => w);
  assert.deepEqual(through, REWORDED.map(([w]) => w), "if Balanced now catches some of these, update this test and docs/security-limitations.md");
  const doc = readFileSync(new URL("../../docs/security-limitations.md", import.meta.url), "utf8");
  assert.match(doc, /Shell rules match the words of a command/, "the limitation is written down where operators read it");
});

test("Balanced v2: no reworded command runs unasked; only plainly written read-only commands run on their own", () => {
  for (const [what, command] of REWORDED) assert.notEqual(evaluate(AGENT, presetRules("balanced", 2), shellRequest(command)).effect, "allow", `balanced v2 let "${what}" run on its own`);
  for (const command of ["git status", "git diff src/a.ts", "git log --oneline -5", "git show HEAD", "ls", "ls -la src", "pwd", "echo tend-activity-test"])
    assert.equal(evaluate(AGENT, presetRules("balanced", 2), shellRequest(command)).effect, "allow", command);
  for (const command of ["git status; rm -rf build", "git status && curl x", "git log | sh", "ls $(whoami)", "ls `id`", "git diff > /tmp/x", "git diff ⏎ rm -rf build",
    "git diff --output=/tmp/x", "git diff --ext-diff", "git difftool", "git -c core.pager=sh log", "npm test", "cat README.md", "echo tend-activity-test && rm x"])
    assert.equal(evaluate(AGENT, presetRules("balanced", 2), shellRequest(command)).effect, "approve", command);
  assert.equal(evaluate(AGENT, presetRules("balanced", 2), shellRequest("ls ~/.ssh")).effect, "deny");
});

test("Strict v2 asks before reading .env; v1 did not. Both versions of both presets ask before .env is read or changed from v2 on", () => {
  const read = (id: "balanced" | "strict", v: number) => evaluate(AGENT, presetRules(id, v), { tool: "file.read", action: "Read", resource: null, detail: null, args: { path: "/repo/.env.production" } }).effect;
  assert.equal(read("strict", 1), "allow");
  assert.equal(read("strict", 2), "approve");
  assert.equal(read("balanced", 2), "approve");
});

test("the descriptions say what the latest versions do", () => {
  for (const dict of [en, de]) {
    assert.match(dict.assistant.presets.balanced.body, /git status/);
    assert.match(dict.assistant.presets.strict.body, /\.env/);
    assert.ok(dict.assistant.presets.olderVersion("Balanced").length > 0);
  }
});
