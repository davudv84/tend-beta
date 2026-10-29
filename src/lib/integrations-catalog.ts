// Every way to put TEND in front of an agent. What each one has been shown to do is not written here: it comes from the verification
// report (verification-report.json, written by npm run verify:integrations), so "verified" cannot be claimed by editing this file.
//   verified    every real scenario passed in the last complete run (allow, deny, approve, reject, revoke, TEND unavailable, audit)
//   blocked     implemented, but the real run needs something that is not here (a provider key, an installed agent)
//   compatible  implemented; no complete real run yet, or the last one did not pass
//   planned     not implemented: nothing to connect
// "connected" is not stored: the page shows it when an agent of this kind is connected to this TEND but the integration is not verified.
// Texts shown to people live in the dictionaries (integrations.items).
import type { BrandSlug } from "./brand-icons";
import type { Agent, Provider, TaskEvent } from "./types";
import REPORT from "./verification-report.json" with { type: "json" };

export type IntegrationStatus = "verified" | "connected" | "compatible" | "blocked" | "planned";
export type IntegrationCategory = "provider" | "agent" | "framework" | "protocol";
/** Which instructions the connect flow shows (connect-snippet.ts). */
export type ConnectKind = "claude" | "openai" | "chat" | "mcp" | "http" | "js" | "python";
export type IntegrationId =
  | "claude" | "openaiApi" | "gemini" | "mistral" | "groq" | "ollama"
  | "hermes" | "claudeCode" | "openai" | "openclaw" | "cursor" | "cline" | "aider"
  | "langchain" | "langgraph" | "crewai" | "autogen" | "pydanticAi" | "mastra"
  | "mcp" | "http" | "openaiCompatible";
export const SCENARIOS = ["allow", "deny", "approve", "reject", "revoke", "unavailable", "audit"] as const;
export type Scenario = (typeof SCENARIOS)[number];
export interface Verification {
  status: "verified" | "failed" | "blocked";
  /** What the run really exercised: model, SDK or host, and how it was reached. */
  label: string;
  scenarios?: { scenario: Scenario; verdict: "PASS" | "FAIL" | "ERROR" | "INCONCLUSIVE"; why?: string; failed?: string[] }[];
  missing?: string[];
  verifiedAt?: string;
  previouslyVerifiedAt?: string;
  lastRunAt?: string;
  lastCheckedAt?: string;
}
export interface Integration {
  id: IntegrationId;
  name: string;
  category: IntegrationCategory;
  /** The brand mark in brand-icons.ts, only where an official one exists. Never evidence of anything. */
  logo?: BrandSlug;
  /** What an agent using it is registered as in TEND. */
  provider?: Provider;
  /** Absent: not implemented, so it cannot be connected. */
  connect?: ConnectKind;
}

export const INTEGRATIONS: Integration[] = [
  { id: "claude", name: "Anthropic", logo: "anthropic", category: "provider", provider: "Anthropic", connect: "claude" },
  { id: "openaiApi", name: "OpenAI", category: "provider", provider: "OpenAI", connect: "chat" },
  { id: "gemini", name: "Google Gemini", logo: "googlegemini", category: "provider", provider: "Google", connect: "chat" },
  { id: "mistral", name: "Mistral AI", logo: "mistralai", category: "provider", provider: "Custom", connect: "chat" },
  { id: "groq", name: "Groq", category: "provider", provider: "Custom", connect: "chat" },
  { id: "ollama", name: "Ollama", logo: "ollama", category: "provider", provider: "Custom", connect: "chat" },

  { id: "hermes", name: "Hermes Agent", category: "agent", provider: "Custom", connect: "mcp" },
  { id: "claudeCode", name: "Claude Code", logo: "claudecode", category: "agent", provider: "Custom", connect: "mcp" },
  { id: "openai", name: "OpenAI Agents SDK", category: "agent", provider: "OpenAI", connect: "openai" },
  { id: "openclaw", name: "OpenClaw", category: "agent", provider: "Custom", connect: "mcp" },
  { id: "cursor", name: "Cursor", logo: "cursor", category: "agent", provider: "Custom", connect: "mcp" },
  { id: "cline", name: "Cline", logo: "cline", category: "agent", provider: "Custom", connect: "mcp" },
  { id: "aider", name: "Aider", category: "agent" },

  { id: "langchain", name: "LangChain", logo: "langchain", category: "framework", provider: "Anthropic", connect: "js" },
  { id: "langgraph", name: "LangGraph", logo: "langgraph", category: "framework", provider: "Anthropic", connect: "js" },
  { id: "crewai", name: "CrewAI", logo: "crewai", category: "framework", provider: "Anthropic", connect: "python" },
  { id: "autogen", name: "AutoGen", category: "framework", provider: "Anthropic", connect: "python" },
  { id: "pydanticAi", name: "PydanticAI", category: "framework", provider: "Anthropic", connect: "python" },
  { id: "mastra", name: "Mastra", category: "framework", provider: "Anthropic", connect: "js" },

  { id: "mcp", name: "Model Context Protocol", logo: "modelcontextprotocol", category: "protocol", provider: "Custom", connect: "mcp" },
  { id: "http", name: "HTTP API", category: "protocol", provider: "Custom", connect: "http" },
  { id: "openaiCompatible", name: "OpenAI-compatible API", category: "protocol", provider: "Custom", connect: "chat" },
];

const REPORTED = (REPORT as { integrations: Partial<Record<IntegrationId, Verification>> }).integrations;
export const verificationOf = (entry: Pick<Integration, "id">, report = REPORTED): Verification | undefined => report[entry.id];

/** The stored status. Verified needs a complete run in which every scenario passed; nothing else can produce it. */
export function statusOf(entry: Integration, report = REPORTED): Exclude<IntegrationStatus, "connected"> {
  if (!entry.connect) return "planned";
  const v = report[entry.id];
  if (v?.status === "verified" && SCENARIOS.every((s) => v.scenarios?.some((x) => x.scenario === s && x.verdict === "PASS"))) return "verified";
  return v?.status === "blocked" ? "blocked" : "compatible";
}
/** The status the page shows: an unverified integration with an agent connected here reads "connected". */
export const shownStatus = (entry: Integration, connectedHere: number, report = REPORTED): IntegrationStatus => {
  const s = statusOf(entry, report);
  return s !== "verified" && s !== "planned" && connectedHere > 0 ? "connected" : s;
};
export const STATUS_ORDER: IntegrationStatus[] = ["verified", "connected", "compatible", "blocked", "planned"];

/** TEND records an agent's provider, not the integration it connected with; each provider's own entry is the one its agents count for. */
export const PROVIDER_HOME: Record<Provider, IntegrationId> = { Anthropic: "claude", OpenAI: "openaiApi", Google: "gemini", Custom: "http" };

/** What this TEND has seen: connected agents registered with this entry's provider, and when one last ran an action TEND had authorized.
 * `shared` means those agents may have connected through another integration of the same provider, so they do not make this one "connected". */
export function liveStatus(entry: Integration, agents: Pick<Agent, "id" | "origin" | "provider">[], events: Pick<TaskEvent, "agentId" | "type" | "outcome" | "authorizationId" | "at">[]) {
  const shared = !entry.provider || PROVIDER_HOME[entry.provider] !== entry.id;
  if (!entry.provider || !entry.connect) return { count: 0, lastVerifiedAt: null as number | null, shared };
  const ids = new Set(agents.filter((a) => a.origin === "connected" && a.provider === entry.provider).map((a) => a.id));
  let lastVerifiedAt: number | null = null;
  for (const e of events) if (ids.has(e.agentId) && e.type === "tool.called" && e.outcome === "success" && e.authorizationId && (lastVerifiedAt === null || e.at > lastVerifiedAt)) lastVerifiedAt = e.at;
  return { count: ids.size, lastVerifiedAt, shared };
}

/** Search over the name, the id ("mcp"), the shown summary and the category, case-insensitive. */
export const matches = (entry: Integration, summary: string, q: string) => {
  const s = q.trim().toLowerCase();
  return !s || entry.name.toLowerCase().includes(s) || entry.id.toLowerCase().includes(s) || summary.toLowerCase().includes(s) || entry.category.includes(s);
};
