// Invented data for the screens on the homepage. Three agents, their requests and a few decisions, shaped like the app's own records
// so the same words and components apply. Nothing here is ever sent anywhere; times are given as minutes, so the screens read the
// same on the server and in every browser.
import { presetRules } from "@/lib/agent-presets";
import type { IntegrationId } from "@/lib/integrations-catalog";
import type { RuleLike } from "@/lib/permissions";
import type { Agent, Authorization } from "@/lib/types";

const agent = (id: string, name: string, model: string, provider: Agent["provider"]): Agent => ({
  id, name, model, provider, role: "", description: "", status: "active", integrationEnabled: true, permissions: [], cadenceHours: 0,
  connectedAt: 0, origin: "connected", lastSeenAt: 0, configVersion: 1, ackedVersion: 1, public: false,
});

export const OPS_AGENT = agent("ag_demo_ops", "ops-agent", "claude-haiku-4-5", "Anthropic");
export const REPO_HELPER = agent("ag_demo_repo", "repo-helper", "Claude Code", "Custom");
export const RESEARCH_AGENT = agent("ag_demo_research", "research-agent", "LangChain", "Anthropic");

/** The Balanced preset's own rules (lib/agent-presets.ts), so the demo shows the sentences the app would really show. */
const BALANCED = presetRules("balanced");
const has = (r: RuleLike, field: string, value: string) => JSON.stringify((r.when as Record<string, unknown> | undefined)?.[field] ?? "").includes(value);
export const GIT_PUSH_RULE = BALANCED.find((r) => r.tool === "shell" && has(r, "command", "git push"))!;
export const SSH_READ_RULE = BALANCED.find((r) => r.tool === "file.read" && has(r, "path", ".ssh"))!;
export const SHELL_ALLOW_RULE = BALANCED.find((r) => r.tool === "shell" && r.action === "*" && !r.when)!;

type Pending = Omit<Authorization, "createdAt" | "expiresAt" | "alerts"> & { askedMinutesAgo: number; lapsesInMinutes: number };

/** The two requests waiting on the hero's Overview screen. */
// The gateway's own shapes (docs/gateway.md): resource "INV-" and digits, detail "EUR <amount> to <payee> (<payee id>)"; request ids are
// "az_" and 24 hex characters (server/authz.ts).
export const INVOICE_REQUEST: Pending = {
  id: "az_5c1e09a7d3f24b8e6a0c71f2", agentId: OPS_AGENT.id, tool: "pay_invoice", action: "execute", resource: "INV-2026118",
  detail: "EUR 4800.00 to Acme GmbH (PAYEE-7)", status: "pending", reason: "approval_required", askedMinutesAgo: 2, lapsesInMinutes: 8,
};
export const PUSH_REQUEST: Pending = {
  id: "az_9b03f6e2c4a17d58e0b2a913", agentId: REPO_HELPER.id, tool: "shell", action: "Bash",
  detail: "Run: git push --force origin main", status: "pending", reason: "approval_required", rule: GIT_PUSH_RULE, askedMinutesAgo: 4, lapsesInMinutes: 6,
};

/** A decision as the history table and the Activity table show it. `time` is a clock reading, the same in both languages. */
export interface DemoDecision {
  time: string;
  agent: Agent;
  detail: string;
  tool: string;
  action: string;
  outcome: "ran" | "blocked" | "rejected" | "allowed" | "needs_approval" | "approved" | "expired";
  /** How it got there, when it took more than one step ("Needs approval → Rejected"), as the app's table folds one action into one row. */
  path?: ("needs_approval" | "approved" | "rejected" | "expired" | "ran")[];
  why: { kind: "rule"; rule: RuleLike } | { kind: "person" } | { kind: "reason"; reason: string };
}

export const HISTORY: DemoDecision[] = [
  { time: "13:58", agent: REPO_HELPER, detail: "Run: npm test", tool: "shell", action: "Bash", outcome: "ran", why: { kind: "rule", rule: SHELL_ALLOW_RULE } },
  { time: "13:41", agent: REPO_HELPER, detail: "Read: ~/.ssh/id_ed25519", tool: "file.read", action: "Read", outcome: "blocked", why: { kind: "rule", rule: SSH_READ_RULE } },
  { time: "13:12", agent: RESEARCH_AGENT, detail: "Open: https://api.example.com/refunds", tool: "web", action: "WebFetch", outcome: "rejected", why: { kind: "person" } },
];

/** What the Activity screen on the closing card lists: the two waiting requests and the four decisions before them. */
export const ACTIVITY: DemoDecision[] = [
  { time: "14:02", agent: OPS_AGENT, detail: INVOICE_REQUEST.detail!, tool: INVOICE_REQUEST.tool, action: INVOICE_REQUEST.action, outcome: "needs_approval", why: { kind: "reason", reason: "approval_required" } },
  { time: "14:00", agent: REPO_HELPER, detail: PUSH_REQUEST.detail!, tool: PUSH_REQUEST.tool, action: PUSH_REQUEST.action, outcome: "rejected", path: ["needs_approval", "rejected"], why: { kind: "person" } },
  HISTORY[0],
  HISTORY[1],
  { time: "13:30", agent: REPO_HELPER, detail: "Read: src/app/page.tsx", tool: "file.read", action: "Read", outcome: "allowed", why: { kind: "reason", reason: "policy_allowed" } },
  HISTORY[2],
];

/**
 * The Overview screen in the hero: the agents as its list shows them (ui/agent-row.tsx), waiting ones first, each with the mark of
 * the product it runs on and its latest request. `doing` is the word the row puts before a request that did not simply run.
 */
export interface DemoAgentLine {
  agent: Agent;
  integration: IntegrationId;
  live: boolean;
  doing?: "waiting" | "blocked" | "rejected";
  detail: string;
  minutesAgo: number;
}
export const AGENT_LINES: DemoAgentLine[] = [
  { agent: OPS_AGENT, integration: "claude", live: true, doing: "waiting", detail: INVOICE_REQUEST.detail!, minutesAgo: 2 },
  { agent: REPO_HELPER, integration: "claudeCode", live: true, doing: "rejected", detail: PUSH_REQUEST.detail!, minutesAgo: 4 },
  { agent: RESEARCH_AGENT, integration: "langchain", live: false, detail: "Open: https://docs.stripe.com/api/invoices", minutesAgo: 38 },
];

/** Overview's four numbers. Blocked counts the two decisions above that did not run (the key read and the email). */
export const OVERVIEW_STATS = { running: 2, agents: AGENT_LINES.length, waiting: 2, auto: 14, blocked: 2 };
