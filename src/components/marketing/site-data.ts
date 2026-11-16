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
// The CLI's own output (scripts/tend-cli.mjs, tester-agent.mjs, verify-integrations.mjs), line for line, with the same sample workspace as
// the screenshots: ids are "az_" and 24 hex characters, hashes 64, as TEND writes them.
const PUSH = "az_ca260092b06e4f31b77974cc";
const REFUND = "az_bc45c3c44af4488e9bebc629";
const CLAUDE = "Claude Code · checkout-service";
const HEAD = "9c41e7b2d05f8a3c6e19b47d2a8f0c53e6d1b9a47f2c08e5d3b6a91c4e7f20d8";
const FIRST = "3f0a6c1e9b7d24f5a8c03e6b1d9f74a2c5e80b3d6f1a9c4e7b2d05f8a3c6e19b";
const wants = (id: string, agent: string, call: string, exactly: string) => [`${id}  ${agent} wants ${call}`, `    exactly: ${exactly}`, `    decide:  npm run tend -- approve ${id}   |   npm run tend -- reject ${id}`];

export const TERMINALS: Record<"approvals" | "rules" | "activity" | "agents" | "checks" | "home", { cwd: string; lines: TermLine[] }> = {
  home: {
    cwd: "~/tend",
    lines: [
      { cmd: "npm run tend -- pending", out: wants(PUSH, CLAUDE, "shell.Bash", "Run: git push origin feature/discount-codes") },
      { cmd: `npm run tend -- approve ${PUSH}`, out: [`Allowed once: ${PUSH}`] },
    ],
  },
  approvals: {
    cwd: "~/tend",
    lines: [
      { cmd: "npm run tend -- pending", out: [...wants(PUSH, CLAUDE, "shell.Bash", "Run: git push origin feature/discount-codes"), ...wants(REFUND, "Support agent", "issue_refund.refund order-48213", "Refund €42.00 to the card used for order #48213")] },
      { cmd: `npm run tend -- approve ${PUSH}`, out: [`Allowed once: ${PUSH}`] },
      { cmd: `npm run tend -- reject ${REFUND}`, out: [`Rejected: ${REFUND}`] },
    ],
  },
  rules: {
    cwd: "~/tend",
    lines: [
      { cmd: 'npm run tend -- policy create "Baseline" --rule send_email:send:approve --rule delete_customer:delete:deny --assign "Support agent"', out: ['Created "Baseline" v1: send_email.send=approve, delete_customer.delete=deny; agents: Support agent'] },
      { cmd: 'npm run tend -- simulate "Baseline" --rule send_email:send:deny', out: ["Simulated against 42 recorded action(s) from the last 30 day(s). Nothing was run or saved.", "  would allow 30, ask 0, block 12   (it was: allowed 30, asked 12, blocked 0)", "  12 approve -> deny", "  Support agent: 42 action(s), 12 decided differently"] },
    ],
  },
  activity: {
    cwd: "~/tend",
    lines: [
      { cmd: 'npm run tend -- audit --agent "Support agent" --last 3', out: ["2026-11-16 07:58:12  Support agent: denied delete_customer.delete customer-5521 (policy_denied)", "2026-11-16 08:06:40  Support agent: requested issue_refund.refund order-48213 (approval_required)", "2026-11-16 08:07:31  Support agent: a person approved a held request"] },
      { cmd: "npm run tend -- audit-verify", out: ["Audit chain intact: 1284 event(s) checked from #1.", `Checkpoint to keep outside TEND:  --checkpoint "1:${FIRST}:1284:${HEAD}"`, "Re-run later with that flag: a cut prefix, an altered oldest event, or a rewrite up to it will then be caught."] },
    ],
  },
  agents: {
    cwd: "~/tend",
    lines: [
      { cmd: 'npm run tester:agent -- "My agent" --rule read_ticket:read:allow', out: ['I registered "My agent" (my-agent); key saved in .env.agent as TEND_AGENT_KEY.', "  read_ticket.read: allowed"] },
      { cmd: "npm run tend -- status", out: ["TEND at http://localhost:3000", `Agents: ${CLAUDE}, Support agent, Research agent, Nightly data sync, My agent`, "Central policies: none", "Waiting for you: 3 (npm run tend -- pending)"] },
    ],
  },
  checks: {
    cwd: "~/tend",
    lines: [
      { cmd: "npm run verify:integrations", out: ["claude: claude-haiku-4-5 via the official Anthropic SDK (@anthropic-ai/sdk)", "  allow        PASS  6.1s  $0.0021", "  deny         PASS  5.4s  $0.0019", "  approve      PASS  7.8s  $0.0024", "  reject       PASS  6.6s  $0.0022", "  revoke       PASS  5.9s  $0.0020", "  unavailable  PASS  6.3s  $0.0023", "  audit        PASS", "  => VERIFIED  ($0.0129)"] },
    ],
  },
};
