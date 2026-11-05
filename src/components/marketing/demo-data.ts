// Invented data for the screens on the homepage. Two agents, their requests and a few decisions, shaped like the app's own records
// so the same words and components apply. Nothing here is ever sent anywhere; times are given as minutes, so the screens read the
// same on the server and in every browser.
import { presetRules } from "@/lib/agent-presets";
import type { RuleLike } from "@/lib/permissions";
import type { Agent, Authorization } from "@/lib/types";

const agent = (id: string, name: string, model: string, provider: Agent["provider"]): Agent => ({
  id, name, model, provider, role: "", description: "", status: "active", integrationEnabled: true, permissions: [], cadenceHours: 0,
  connectedAt: 0, origin: "connected", lastSeenAt: 0, configVersion: 1, ackedVersion: 1, public: false,
});

export const OPS_AGENT = agent("ag_demo_ops", "ops-agent", "claude-haiku-4-5", "Anthropic");
export const REPO_HELPER = agent("ag_demo_repo", "repo-helper", "Claude Code", "Custom");

/** The Balanced preset's own rules (lib/agent-presets.ts), so the demo shows the sentences the app would really show. */
const BALANCED = presetRules("balanced");
const has = (r: RuleLike, field: string, value: string) => JSON.stringify((r.when as Record<string, unknown> | undefined)?.[field] ?? "").includes(value);
export const GIT_PUSH_RULE = BALANCED.find((r) => r.tool === "shell" && has(r, "command", "git push"))!;
export const SSH_READ_RULE = BALANCED.find((r) => r.tool === "file.read" && has(r, "path", ".ssh"))!;
export const SHELL_ALLOW_RULE = BALANCED.find((r) => r.tool === "shell" && r.action === "*" && !r.when)!;

type Pending = Omit<Authorization, "createdAt" | "expiresAt" | "alerts"> & { askedMinutesAgo: number; lapsesInMinutes: number };

/** The two requests waiting on the hero's Approvals screen. */
export const INVOICE_REQUEST: Pending = {
  id: "az_demo_invoice", agentId: OPS_AGENT.id, tool: "pay_invoice", action: "pay", resource: "2026-118",
  detail: "Pay invoice 2026-118: 4,800 EUR to Acme GmbH", status: "pending", reason: "approval_required", askedMinutesAgo: 2, lapsesInMinutes: 8,
};
export const PUSH_REQUEST: Pending = {
  id: "az_demo_push", agentId: REPO_HELPER.id, tool: "shell", action: "Bash",
  detail: "Run: git push --force origin main", status: "pending", reason: "approval_required", rule: GIT_PUSH_RULE, askedMinutesAgo: 4, lapsesInMinutes: 6,
};

/** A decision as the history table and the Activity table show it. `time` is a clock reading, the same in both languages. */
export interface DemoDecision {
  time: string;
  agent: Agent;
  detail: string;
  tool: string;
  action: string;
  outcome: "ran" | "blocked" | "rejected" | "allowed" | "needs_approval" | "approved";
  why: { kind: "rule"; rule: RuleLike } | { kind: "person" } | { kind: "reason"; reason: string };
}

export const HISTORY: DemoDecision[] = [
  { time: "13:58", agent: REPO_HELPER, detail: "Run: npm test", tool: "shell", action: "Bash", outcome: "ran", why: { kind: "rule", rule: SHELL_ALLOW_RULE } },
  { time: "13:41", agent: REPO_HELPER, detail: "Read: ~/.ssh/id_ed25519", tool: "file.read", action: "Read", outcome: "blocked", why: { kind: "rule", rule: SSH_READ_RULE } },
  { time: "13:12", agent: OPS_AGENT, detail: "Send email to billing@example.com", tool: "send_email", action: "send", outcome: "rejected", why: { kind: "person" } },
];

/** What the Activity screen on the closing card lists: the two waiting requests and the four decisions before them. */
export const ACTIVITY: DemoDecision[] = [
  { time: "14:02", agent: OPS_AGENT, detail: INVOICE_REQUEST.detail!, tool: INVOICE_REQUEST.tool, action: INVOICE_REQUEST.action, outcome: "needs_approval", why: { kind: "reason", reason: "approval_required" } },
  { time: "14:00", agent: REPO_HELPER, detail: PUSH_REQUEST.detail!, tool: PUSH_REQUEST.tool, action: PUSH_REQUEST.action, outcome: "needs_approval", why: { kind: "rule", rule: GIT_PUSH_RULE } },
  HISTORY[0],
  HISTORY[1],
  { time: "13:30", agent: REPO_HELPER, detail: "Read: src/app/page.tsx", tool: "file.read", action: "Read", outcome: "allowed", why: { kind: "reason", reason: "policy_allowed" } },
  HISTORY[2],
];
