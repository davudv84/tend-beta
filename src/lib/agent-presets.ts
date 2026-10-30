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
  if (id === "monitor") return [...ALWAYS.slice(0, 2), ...["shell", "file.write", "file.read", "web", "mcp", "agent"].map((k) => all(k, "allow"))];
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
