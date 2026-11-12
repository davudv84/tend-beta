// Invented data for the clickable screens on the homepage and the product pages (components/marketing/panels). Four agents, the tools
// they use, the rules that decide them and a short activity log. Nothing here is sent anywhere. Words come from the dictionary
// (front.kit); this file holds only names, ids, times and the decision logic, which mirrors the app's: a choice per tool, anything not
// listed is blocked, and paying always asks first.
import type { IntegrationId } from "@/lib/integrations-catalog";

/** The product pages, in the menu's order (/product/<slug>). */
export const PRODUCTS = ["approvals", "rules", "activity", "agents", "checks"] as const;
export type ProductSlug = (typeof PRODUCTS)[number];

export type ToolId = "read_ticket" | "send_email" | "pay_invoice" | "delete_record" | "shell" | "database";
export type Choice = "allow" | "ask" | "never";
export type Verdict = Choice | "unlisted";
export type AgentKey = "ops" | "repo" | "research" | "support";

/** The tools that have a rule. `database` has none, so a call to it shows what "not listed" means. */
export const RULED = ["read_ticket", "send_email", "pay_invoice", "delete_record", "shell"] as const satisfies readonly ToolId[];
export type RuledTool = (typeof RULED)[number];
export const CALLS: ToolId[] = ["read_ticket", "send_email", "pay_invoice", "delete_record", "shell", "database"];

export const ACTION: Record<ToolId, string> = { read_ticket: "read", send_email: "send", pay_invoice: "pay", delete_record: "delete", shell: "run", database: "query" };
/** Paying can never be set to Allow: the server refuses to let a spending tool run without approval. */
export const SPEND: ToolId[] = ["pay_invoice"];
export const DEFAULT_RULES: Record<RuledTool, Choice> = { read_ticket: "allow", send_email: "ask", pay_invoice: "ask", delete_record: "never", shell: "ask" };
export const CHOICES: Choice[] = ["allow", "ask", "never"];

/** What TEND decides for a call to `tool` under `rules`. */
export const decide = (rules: Partial<Record<ToolId, Choice>>, tool: ToolId): Verdict => rules[tool] ?? "unlisted";

export interface DemoAgent { key: AgentKey; name: string; integration: IntegrationId; live: boolean; waiting: number; lastMinutes: number }
export const AGENTS: DemoAgent[] = [
  { key: "ops", name: "ops-agent", integration: "claude", live: true, waiting: 1, lastMinutes: 2 },
  { key: "repo", name: "repo-helper", integration: "claudeCode", live: true, waiting: 1, lastMinutes: 4 },
  { key: "support", name: "support-bot", integration: "crewai", live: true, waiting: 0, lastMinutes: 46 },
  { key: "research", name: "research-agent", integration: "langchain", live: false, waiting: 0, lastMinutes: 38 },
];
export const agentOf = (key: AgentKey) => AGENTS.find((a) => a.key === key)!;
/** Who asks for each tool in the examples. */
export const CALLER: Record<ToolId, AgentKey> = { read_ticket: "support", send_email: "support", pay_invoice: "ops", delete_record: "ops", shell: "repo", database: "research" };

/** The three requests waiting in Approvals: which words, which tool, and how loud the card is. */
export type RequestKey = "invoice" | "push" | "email";
export interface DemoRequest { key: RequestKey; agent: AgentKey; tool: ToolId; kind: "spend" | "run" | "send"; item?: string; mono: boolean; askedMinutesAgo: number }
export const REQUESTS: DemoRequest[] = [
  { key: "invoice", agent: "ops", tool: "pay_invoice", kind: "spend", item: "2026-118", mono: false, askedMinutesAgo: 2 },
  { key: "push", agent: "repo", tool: "shell", kind: "run", mono: true, askedMinutesAgo: 4 },
  { key: "email", agent: "support", tool: "send_email", kind: "send", mono: false, askedMinutesAgo: 9 },
];

/** One entry in the activity log. `outcome` uses the app's own outcome words (timelinePage.outcome). */
export type Outcome = "allowed" | "approved" | "needs_approval" | "blocked" | "rejected";
export interface LogEntry { id: number; time: string; agent: AgentKey; tool: ToolId; outcome: Outcome; by: Verdict | "person"; hash: string }
export const LOG: LogEntry[] = [
  { id: 7, time: "14:02", agent: "ops", tool: "pay_invoice", outcome: "needs_approval", by: "ask", hash: "9c41e7" },
  { id: 6, time: "14:00", agent: "repo", tool: "shell", outcome: "needs_approval", by: "ask", hash: "e0b25d" },
  { id: 5, time: "13:58", agent: "support", tool: "read_ticket", outcome: "allowed", by: "allow", hash: "4a7f03" },
  { id: 4, time: "13:44", agent: "ops", tool: "delete_record", outcome: "blocked", by: "never", hash: "b72e04" },
  { id: 3, time: "13:31", agent: "research", tool: "database", outcome: "blocked", by: "unlisted", hash: "c41d88" },
  { id: 2, time: "13:12", agent: "support", tool: "send_email", outcome: "approved", by: "person", hash: "8e07f2" },
  { id: 1, time: "12:50", agent: "repo", tool: "shell", outcome: "rejected", by: "person", hash: "3f9a1c" },
];
/** The filter an outcome falls under. */
export const GROUP_OF: Record<Outcome, "allowed" | "waiting" | "blocked"> = { allowed: "allowed", approved: "allowed", needs_approval: "waiting", blocked: "blocked", rejected: "blocked" };

/** How many calls ran, waited and were blocked in each of the last 24 hours (oldest first). */
export const DAY = {
  ran: [3, 2, 1, 1, 0, 0, 1, 2, 4, 6, 7, 5, 6, 8, 7, 6, 5, 7, 9, 6, 4, 3, 5, 4],
  waited: [0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 2, 1, 0, 1, 2, 1, 0, 1, 1, 0, 1, 0, 1, 2],
  blocked: [0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1],
};
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** A line in a terminal: a command and what it printed. Commands are TEND's real ones (scripts/tend-cli.mjs); the output is an example. */
export interface TermLine { cmd: string; out?: string[] }
export const TERMINALS: Record<"approvals" | "rules" | "activity" | "agents" | "checks" | "home", { cwd: string; lines: TermLine[] }> = {
  home: {
    cwd: "~/tend",
    lines: [
      { cmd: "npm run tend -- pending", out: ["az_7f2c  ops-agent wants pay_invoice.pay 2026-118", "    exactly: Pay invoice 2026-118: 4,800 EUR to Acme GmbH"] },
      { cmd: "npm run tend -- approve az_7f2c", out: ["Allowed once: az_7f2c"] },
    ],
  },
  approvals: {
    cwd: "~/tend",
    lines: [
      { cmd: "npm run tend -- pending", out: ["az_7f2c  ops-agent wants pay_invoice.pay 2026-118", "    exactly: Pay invoice 2026-118: 4,800 EUR to Acme GmbH", "az_91d0  repo-helper wants shell.run", "    exactly: Run: git push --force origin main"] },
      { cmd: "npm run tend -- approve az_7f2c", out: ["Allowed once: az_7f2c"] },
      { cmd: "npm run tend -- reject az_91d0", out: ["Rejected: az_91d0"] },
    ],
  },
  rules: {
    cwd: "~/tend",
    lines: [
      { cmd: 'npm run tend -- policy create "Baseline" --rule send_email:send:approve --rule delete_record:delete:deny --assign "ops-agent"', out: ['Created "Baseline" v1: send_email.send=approve, delete_record.delete=deny; agents: ops-agent'] },
      { cmd: 'npm run tend -- simulate "Baseline" --rule send_email:send:deny', out: ["Simulated against 42 recorded action(s) from the last 30 day(s). Nothing was run or saved.", "  would allow 30, ask 0, block 12   (it was: allowed 30, asked 12, blocked 0)"] },
    ],
  },
  activity: {
    cwd: "~/tend",
    lines: [
      { cmd: 'npm run tend -- audit --agent "ops-agent" --last 3', out: ["2026-11-08 13:44:12  ops-agent: denied delete_record.delete C-311 (policy_denied)", "2026-11-08 14:02:31  ops-agent: requested pay_invoice.pay 2026-118 (approval_required)", "2026-11-08 14:03:05  ops-agent: a person approved a held request"] },
      { cmd: "npm run tend -- audit-verify", out: ["Audit chain intact: 7 event(s) checked. Head hash: 9c41e7…", "Keep this hash outside TEND; a history rewritten later will not end in it."] },
    ],
  },
  agents: {
    cwd: "~/tend",
    lines: [
      { cmd: 'npm run tester:agent -- "My agent" --rule read_ticket:read:allow', out: ['I registered "My agent" (ag_5d1e); key saved in .env.agent as TEND_AGENT_KEY.', "  read_ticket.read: allowed"] },
      { cmd: "npm run tend -- status", out: ["Agents: ops-agent, repo-helper, support-bot, research-agent, My agent", "Waiting for you: 2 (npm run tend -- pending)"] },
    ],
  },
  checks: {
    cwd: "~/tend",
    lines: [
      { cmd: "npm run verify:integrations", out: ["claudeCode: Claude Code", "  allow        PASS", "  deny         PASS", "  approve      PASS", "  reject       PASS", "  revoke       PASS", "  unavailable  PASS", "  audit        PASS", "  => VERIFIED"] },
    ],
  },
};
