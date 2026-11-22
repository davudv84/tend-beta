// Ready-made policies for coding assistants connected through hooks (examples/hooks/tend-hooks.mjs). The hook files every tool call under a
// kind (shell, file.write, file.read, web, mcp, agent, other) with the assistant's own tool name as the action, and passes the command, path or URL
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
export const HOOK_KINDS = ["shell", "file.write", "file.read", "web", "mcp", "agent", "other"] as const;

const all = (tool: string, effect: RuleLike["effect"]): RuleLike => ({ tool, action: "*", effect });
const when = (tool: string, field: string, op: "contains" | "startsWith", value: string, effect: RuleLike["effect"]): RuleLike => ({ tool, action: "*", effect, when: { [field]: { [op]: value } } });

/** What every preset refuses outright, and the three test commands. String conditions ignore case. */
const ALWAYS: RuleLike[] = [
  when("shell", "command", "startsWith", TEST_COMMANDS.blocked, "deny"),
  when("shell", "command", "startsWith", TEST_COMMANDS.approval, "approve"),
  when("shell", "command", "contains", "rm -rf /", "deny"),
  // SSH keys: by path for the file tools, and by command text for the shell (cat ~/.ssh/id_rsa is a shell call, not a file read). ".ssh"
  // without slashes, so the folder itself counts too (ls ~/.ssh, a search rooted at ~/.ssh itself), not only what is under it.
  when("shell", "command", "contains", ".ssh", "deny"),
  when("file.read", "path", "contains", ".ssh", "deny"),
  when("file.write", "path", "contains", ".ssh", "deny"),
];

/**
 * Presets are versioned. A saved policy is never rewritten: it keeps the rules of the version it was saved with, and presetOf still recognises
 * it. Saving a preset again stores the latest version. What changed, and why, is in docs/security-limitations.md and docs/presets.md.
 *   balanced v1  shell runs unless its TEXT names a risky command (git push, rm, curl…): a reworded command gets past it.
 *   balanced v2  shell waits for a person, except a short list of read-only commands written plainly (no ; & | $ ` > < or line break).
 *   strict   v1  everything that changes or reaches out waits; reading any file is allowed (.env included).
 *   strict   v2  as v1, and reading .env waits too.
 *   monitor  v1  everything runs and is recorded.
 */
export const PRESET_VERSIONS: Record<PresetId, readonly number[]> = { balanced: [1, 2], strict: [1, 2], monitor: [1] };
export const LATEST: Record<PresetId, number> = { balanced: 2, strict: 2, monitor: 1 };

/** Read-only commands Balanced v2 lets run without asking, matched from the start of the command. Nothing that prints file contents. */
export const READ_ONLY_COMMANDS = ["git status", "git diff", "git log", "git show", "ls "] as const;
/** Exact commands Balanced v2 lets run. Exact, so nothing can be appended to them. */
const EXACT_COMMANDS = ["ls", "pwd", "git status", "git diff", "git log", TEST_COMMANDS.activity] as const;
/**
 * Text that turns a read-only command into something else: chaining, pipes, substitution, redirection, a second line, and git's options that
 * write files or run programs (the hook turns a line break into ⏎ before TEND sees the command). A command containing any of these waits for a person even if it starts like a read-only one: the approve rule
 * is as specific as the allow rule, and at equal specificity the stricter effect wins (policy.ts).
 */
export const SHELL_ESCAPES = [";", "&", "|", "$", "`", ">", "<", "⏎", "--output", "--ext-diff", "--textconv", "difftool", "-c "] as const;

export function presetRules(id: PresetId, version = LATEST[id]): RuleLike[] {
  if (!PRESET_VERSIONS[id].includes(version)) throw new Error(`There is no version ${version} of the ${id} preset.`);
  // Monitoring only: everything runs and is recorded. The two test rules stay, so the protection test still shows what TEND does.
  if (id === "monitor") return [...ALWAYS.slice(0, 2), ...HOOK_KINDS.map((k) => all(k, "allow"))];
  const ask = (field: string, value: string, tool = "shell") => when(tool, field, "contains", value, "approve");
  if (id === "strict") {
    const base = [all("shell", "approve"), all("file.write", "approve"), all("file.read", "allow"), all("web", "approve"), all("mcp", "approve"), all("agent", "allow"), all("other", "approve")];
    return version === 1 ? [...ALWAYS, ...base] : [...ALWAYS, ...base, ask("path", ".env", "file.read")];
  }
  const files = [ask("path", ".env", "file.write"), ask("path", ".env", "file.read"), ask("path", "/.git/", "file.write")];
  if (version === 1)
    return [...ALWAYS, all("shell", "allow"), all("file.write", "allow"), all("file.read", "allow"), all("web", "approve"), all("mcp", "approve"), all("agent", "allow"), all("other", "approve"),
      // Commands that publish, delete, escalate or reach the network wait for a person; everything else runs as the assistant's own rules allow.
      ...["git push", "rm ", "sudo ", "curl ", "wget ", "ssh ", "scp ", "npm publish", "chmod ", "kubectl ", "terraform "].map((c) => ask("command", c)),
      ...files];
  // v2: the shell waits by default; a short allow-list of read-only commands runs on its own unless the text escapes it.
  const exact = (c: string): RuleLike => ({ tool: "shell", action: "*", effect: "allow", when: { command: { equals: c } } });
  return [...ALWAYS, all("shell", "approve"), all("file.write", "allow"), all("file.read", "allow"), all("web", "approve"), all("mcp", "approve"), all("agent", "allow"), all("other", "approve"),
    ...READ_ONLY_COMMANDS.map((c) => when("shell", "command", "startsWith", c, "allow")),
    ...EXACT_COMMANDS.map(exact),
    ...SHELL_ESCAPES.map((c) => ask("command", c)),
    ...files];
}

/** The preset and version a saved policy is, if it is exactly one of them (the order of rules does not matter). */
export function presetVersionOf(rules: RuleLike[]): { id: PresetId; version: number; latest: boolean } | null {
  const key = (r: RuleLike) => JSON.stringify([r.tool, r.action, r.effect, r.when ?? null, r.resourcePrefix ?? null]);
  const saved = new Set(rules.map(key));
  for (const id of PRESETS)
    for (const version of PRESET_VERSIONS[id]) {
      const p = presetRules(id, version);
      if (p.length === saved.size && p.every((r) => saved.has(key(r)))) return { id, version, latest: version === LATEST[id] };
    }
  return null;
}

/** Which preset a saved policy is, in any of its versions. */
export function presetOf(rules: RuleLike[]): PresetId | null {
  return presetVersionOf(rules)?.id ?? null;
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
