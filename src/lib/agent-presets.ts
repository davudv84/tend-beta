// Ready-made policies for coding assistants connected through hooks (examples/hooks/tend-hooks.mjs). The hook files every tool call under a
// kind (shell, file.write, file.read, web, mcp, agent) with the assistant's own tool name as the action, and passes the command, path or URL
// as arguments, so a handful of rules covers every tool, including ones a later version of the assistant adds. Anything a preset does not
// mention is denied by TEND's default (no_policy), never allowed.
import type { RuleLike } from "./permissions";

export type PresetId = "balanced" | "strict" | "monitor";
export const PRESETS: PresetId[] = ["balanced", "strict", "monitor"];
/**
 * The harmless commands "Test my protection" asks the assistant to run. The blocked and approval ones have rules in every preset; those rules
 * can only make a command stricter (deny, approve), so a command that merely starts with them gains nothing. There is deliberately no "allow
 * this test command" rule: "echo tend-x && rm ..." would then pass by its prefix. The activity command is simply whatever the preset decides.
 */
export const TEST_COMMANDS = { activity: "echo tend-activity-test", blocked: "echo tend-blocked-test", approval: "echo tend-approval-test" } as const;

/** The kinds the hook files every tool call under. */
export const HOOK_KINDS = ["shell", "file.write", "file.read", "web", "mcp", "agent"] as const;

const all = (tool: string, effect: RuleLike["effect"]): RuleLike => ({ tool, action: "*", effect });
const when = (tool: string, field: string, op: "contains" | "startsWith", value: string, effect: RuleLike["effect"]): RuleLike => ({ tool, action: "*", effect, when: { [field]: { [op]: value } } });

/** What every preset refuses outright, and the three test commands. String conditions ignore case. */
const ALWAYS: RuleLike[] = [
  when("shell", "command", "startsWith", TEST_COMMANDS.blocked, "deny"),
  when("shell", "command", "startsWith", TEST_COMMANDS.approval, "approve"),
  when("shell", "command", "contains", "rm -rf /", "deny"),
  // SSH keys: by path for the file tools, and by command text for the shell (cat ~/.ssh/id_rsa is a shell call, not a file read).
  when("shell", "command", "contains", ".ssh/", "deny"),
  when("file.read", "path", "contains", "/.ssh/", "deny"),
  when("file.write", "path", "contains", "/.ssh/", "deny"),
];

export function presetRules(id: PresetId): RuleLike[] {
  // Monitoring only: everything runs and is recorded. The two test rules stay, so the protection test still shows what TEND does.
  if (id === "monitor") return [...ALWAYS.slice(0, 2), ...HOOK_KINDS.map((k) => all(k, "allow"))];
  const ask = (field: string, value: string, tool = "shell") => when(tool, field, "contains", value, "approve");
  const base = id === "strict"
    ? [all("shell", "approve"), all("file.write", "approve"), all("file.read", "allow"), all("web", "approve"), all("mcp", "approve"), all("agent", "allow")]
    : [all("shell", "allow"), all("file.write", "allow"), all("file.read", "allow"), all("web", "approve"), all("mcp", "approve"), all("agent", "allow"),
      // Commands that publish, delete, escalate or reach the network wait for a person; everything else runs as the assistant's own rules allow.
      ...["git push", "rm ", "sudo ", "curl ", "wget ", "ssh ", "scp ", "npm publish", "chmod ", "kubectl ", "terraform "].map((c) => ask("command", c)),
      ask("path", ".env", "file.write"), ask("path", ".env", "file.read"), ask("path", "/.git/", "file.write")];
  return [...ALWAYS, ...base];
}

/** Which preset a saved policy is, if it is exactly one of them (the order of rules does not matter). */
export function presetOf(rules: RuleLike[]): PresetId | null {
  const key = (r: RuleLike) => JSON.stringify([r.tool, r.action, r.effect, r.when ?? null, r.resourcePrefix ?? null]);
  const saved = new Set(rules.map(key));
  return PRESETS.find((id) => { const p = presetRules(id); return p.length === saved.size && p.every((r) => saved.has(key(r))); }) ?? null;
}

/** One of the two rules that exist only for "Test my protection". */
export const isTestRule = (r: RuleLike) =>
  r.tool === "shell" && [TEST_COMMANDS.blocked, TEST_COMMANDS.approval].includes((r.when as { command?: { startsWith?: string } } | undefined)?.command?.startsWith as never);

export type Covered = RuleLike & { from: "agent" | "central" };

/**
 * What the saved policies do with hook calls, read from the rules alone: the rules that stop or hold a call before it runs (enforced), the
 * rules that let calls run and only record them (monitored), and the kinds with no catch-all rule in either policy, whose unmatched calls
 * TEND's default blocks. With a central policy assigned, its rules count too: where both match, the stricter one decides (policy.ts
 * evaluateEffective), so every deny or approve rule from either side holds, and an allow holds only where nothing stricter matches. The
 * test-command rules are left out. It describes the policies, not the computer: anything that never reaches a hook is not here.
 */
export function coverageOf(rules: RuleLike[], central: RuleLike[] = []) {
  const hook = [...rules.map((r): Covered => ({ ...r, from: "agent" })), ...central.map((r): Covered => ({ ...r, from: "central" }))]
    .filter((r) => (HOOK_KINDS as readonly string[]).includes(r.tool) && !isTestRule(r));
  const strict = { deny: 0, approve: 1, allow: 2 };
  // A rule that covers exactly what a stricter rule covers never decides anything (the stricter one wins), so it is not listed.
  const scope = (r: RuleLike) => JSON.stringify([r.tool, r.action, r.resourcePrefix ?? null, r.when ?? null]);
  const live = hook.filter((r) => !hook.some((o) => scope(o) === scope(r) && strict[o.effect] < strict[r.effect]));
  return {
    enforced: live.filter((r) => r.effect !== "allow").sort((a, b) => strict[a.effect] - strict[b.effect]),
    monitored: live.filter((r) => r.effect === "allow"),
    unruled: HOOK_KINDS.filter((k) => !hook.some((r) => r.tool === k && r.action === "*" && !r.when && r.resourcePrefix === undefined)),
  };
}
