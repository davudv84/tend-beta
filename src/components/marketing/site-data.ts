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

export const ACTION: Record<ToolId, string> = { read_ticket: "call", send_email: "call", pay_invoice: "execute", delete_record: "call", shell: "Bash", database: "call" };
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

/** A line in a terminal: a command and what it printed. Commands are TEND's real ones (scripts/tend-cli.mjs); the output is an example. */
export interface TermLine { cmd: string; out?: string[] }
// The CLI's own output (scripts/tend-cli.mjs, scripts/tester-agent.mjs, scripts/verify-integrations.mjs), with the sample data: ids are
// "az_" and 24 hex characters, the head hash 64, as TEND writes them.
const INV = "az_5c1e09a7d3f24b8e6a0c71f2";
const PUSH = "az_9b03f6e2c4a17d58e0b2a913";
const HEAD = "9c41e7b2d05f8a3c6e19b47d2a8f0c53e6d1b9a47f2c08e5d3b6a91c4e7f20d8";
const PENDING_INV = [`${INV}  ops-agent wants pay_invoice.execute INV-2026118`, "    exactly: EUR 4800.00 to Acme GmbH (PAYEE-7)", `    decide:  npm run tend -- approve ${INV}   |   npm run tend -- reject ${INV}`];
const PENDING_PUSH = [`${PUSH}  repo-helper wants shell.Bash`, "    exactly: Run: git push --force origin main", `    decide:  npm run tend -- approve ${PUSH}   |   npm run tend -- reject ${PUSH}`];

/** `npm run tend -- audit-verify`, as the Activity page's chain screen. */
export const AUDIT_VERIFY: { cwd: string; lines: TermLine[] } = {
  cwd: "~/tend",
  lines: [{ cmd: "npm run tend -- audit-verify", out: [`Audit chain intact: 1284 event(s) checked. Head hash: ${HEAD}`, "Keep this hash outside TEND; a history rewritten later will not end in it."] }],
};

/** `npm run tend -- policy update`: a central policy changed once, in force for every assigned agent. */
export const CENTRAL_POLICY: { cwd: string; lines: TermLine[] } = {
  cwd: "~/tend",
  lines: [
    { cmd: "npm run tend -- policy list", out: ['"Baseline" v1: send_email.call=approve, delete_record.call=deny; agents: ops-agent'] },
    { cmd: 'npm run tend -- policy assign "Baseline" "repo-helper" "research-agent"', out: ['Assigned: "Baseline" v1: send_email.call=approve, delete_record.call=deny; agents: ops-agent, repo-helper, research-agent'] },
    { cmd: 'npm run tend -- policy update "Baseline" --rule send_email:call:approve --rule delete_record:call:deny --rule write_note:create:approve', out: ['Updated "Baseline" v2: send_email.call=approve, delete_record.call=deny, write_note.create=approve; agents: ops-agent, repo-helper, research-agent (in force for every assigned agent now)'] },
  ],
};

export const TERMINALS: Record<"approvals" | "rules" | "activity" | "agents" | "checks" | "home", { cwd: string; lines: TermLine[] }> = {
  home: {
    cwd: "~/tend",
    lines: [
      { cmd: "npm run tend -- pending", out: PENDING_INV },
      { cmd: `npm run tend -- approve ${INV}`, out: [`Allowed once: ${INV}`] },
    ],
  },
  approvals: {
    cwd: "~/tend",
    lines: [
      { cmd: "npm run tend -- pending", out: [...PENDING_INV, ...PENDING_PUSH] },
      { cmd: `npm run tend -- approve ${INV}`, out: [`Allowed once: ${INV}`] },
      { cmd: `npm run tend -- reject ${PUSH}`, out: [`Rejected: ${PUSH}`] },
    ],
  },
  rules: {
    cwd: "~/tend",
    lines: [
      { cmd: 'npm run tend -- policy create "Baseline" --rule send_email:call:approve --rule delete_record:call:deny --assign "ops-agent"', out: ['Created "Baseline" v1: send_email.call=approve, delete_record.call=deny; agents: ops-agent'] },
      { cmd: 'npm run tend -- simulate "Baseline" --rule send_email:call:deny', out: ["Simulated against 42 recorded action(s) from the last 30 day(s). Nothing was run or saved.", "  would allow 30, ask 0, block 12   (it was: allowed 30, asked 12, blocked 0)", "  12 approve -> deny", "  ops-agent: 42 action(s), 12 decided differently"] },
    ],
  },
  activity: {
    cwd: "~/tend",
    lines: [
      { cmd: 'npm run tend -- audit --agent "ops-agent" --last 3', out: ["2026-11-08 13:44:12  ops-agent: denied delete_record.call C-311 (policy_denied)", "2026-11-08 14:02:31  ops-agent: requested pay_invoice.execute INV-2026118 (approval_required)", "2026-11-08 14:03:05  ops-agent: a person approved a held request"] },
      AUDIT_VERIFY.lines[0],
    ],
  },
  agents: {
    cwd: "~/tend",
    lines: [
      { cmd: 'npm run tester:agent -- "My agent" --rule read_ticket:read:allow', out: ['I registered "My agent" (my-agent); key saved in .env.agent as TEND_AGENT_KEY.', "  read_ticket.read: allowed"] },
      { cmd: "npm run tend -- status", out: ["TEND at http://localhost:3000", "Agents: ops-agent, repo-helper, research-agent, My agent", "Central policies: ", '  "Baseline" v1: send_email.call=approve, delete_record.call=deny; agents: ops-agent', "Waiting for you: 2 (npm run tend -- pending)"] },
    ],
  },
  checks: {
    cwd: "~/tend",
    lines: [
      { cmd: "npm run verify:integrations", out: ["claude: claude-haiku-4-5 via the official Anthropic SDK (@anthropic-ai/sdk)", "  allow        PASS  6.1s  $0.0021", "  deny         PASS  5.4s  $0.0019", "  approve      PASS  7.8s  $0.0024", "  reject       PASS  6.6s  $0.0022", "  revoke       PASS  5.9s  $0.0020", "  unavailable  PASS  6.3s  $0.0023", "  audit        PASS", "  => VERIFIED  ($0.0129)"] },
    ],
  },
};
