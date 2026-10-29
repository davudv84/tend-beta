// Every way to put TEND in front of an agent, with what each claim rests on. "verified" means a real connection was tested end to end and the
// evidence says which; "compatible" means built and tested against stand-ins only; "planned" means nothing is built or tested. A test keeps
// "verified" honest: it is refused without real-connection evidence. Texts shown to people live in the dictionaries (integrations.items).
import type { BrandSlug } from "./brand-icons";
import type { Agent, Provider, TaskEvent } from "./types";

export type IntegrationStatus = "verified" | "compatible" | "planned";
export type IntegrationCategory = "provider" | "agent" | "framework" | "protocol";
export type ConnectKind = "claude" | "openai" | "mcp" | "http";
export type IntegrationId =
  | "claude" | "openaiApi" | "gemini" | "mistral" | "groq" | "ollama"
  | "hermes" | "claudeCode" | "openai" | "openclaw" | "cursor" | "cline" | "aider"
  | "langchain" | "langgraph" | "crewai" | "autogen" | "pydanticAi" | "mastra"
  | "mcp" | "http" | "openaiCompatible";
export interface Evidence {
  /** real-model: a real provider API; protocol: the real protocol with a scripted client; mocked: the provider's API replaced by a stand-in. */
  kind: "real-model" | "real-protocol" | "protocol" | "mocked";
  date: string;
  /** The test or run, as a command or file, so anyone can repeat it. */
  test: string;
}
export interface Integration {
  id: IntegrationId;
  name: string;
  category: IntegrationCategory;
  status: IntegrationStatus;
  /** The brand mark in brand-icons.ts, only where an official one exists. Never evidence of anything. */
  logo?: BrandSlug;
  /** What an agent using it is registered as in TEND. */
  provider?: Provider;
  evidence?: Evidence;
  /** Which instructions the connect flow shows. Absent for planned integrations: they cannot be connected yet. */
  connect?: ConnectKind;
}

const DATE = "2026-10-29";
const MOCKED_OPENAI: Evidence = { kind: "mocked", date: DATE, test: "src/server/real-agents.test.ts: the official Agents SDK against a mocked Responses API (10 tests). No real-API run yet." };
const MCP_PROXY: Evidence = { kind: "protocol", date: DATE, test: "src/server/mcp-proxy.test.ts: a real MCP server process and a scripted MCP client (8 tests). No real MCP host yet." };
/** An MCP host that starts stdio servers from its settings: it can run TEND's MCP proxy, which is tested; the host itself is not. */
const viaProxy = (host: string): Evidence => ({ ...MCP_PROXY, test: `examples/mcp-proxy, tested in src/server/mcp-proxy.test.ts (8 tests) with a scripted MCP client. No real ${host} run yet.` });

export const INTEGRATIONS: Integration[] = [
  { id: "claude", name: "Anthropic", logo: "anthropic", category: "provider", status: "verified", provider: "Anthropic", connect: "claude",
    evidence: { kind: "real-model", date: DATE, test: "npm run e2e:real-claude (Claude Haiku 4.5: allow, deny, approve, reject, revoke, 5/5) and npm run demo:cross" } },
  { id: "openaiApi", name: "OpenAI", category: "provider", status: "compatible", provider: "OpenAI", connect: "openai", evidence: MOCKED_OPENAI },
  { id: "gemini", name: "Google Gemini", logo: "googlegemini", category: "provider", status: "planned" },
  { id: "mistral", name: "Mistral AI", logo: "mistralai", category: "provider", status: "planned" },
  { id: "groq", name: "Groq", category: "provider", status: "planned" },
  { id: "ollama", name: "Ollama", logo: "ollama", category: "provider", status: "planned" },

  { id: "hermes", name: "Hermes Agent", category: "agent", status: "planned" },
  { id: "claudeCode", name: "Claude Code", logo: "claudecode", category: "agent", status: "compatible", provider: "Custom", connect: "mcp", evidence: viaProxy("Claude Code") },
  { id: "openai", name: "OpenAI Agents SDK", category: "agent", status: "compatible", provider: "OpenAI", connect: "openai", evidence: MOCKED_OPENAI },
  { id: "openclaw", name: "OpenClaw", category: "agent", status: "planned" },
  { id: "cursor", name: "Cursor", logo: "cursor", category: "agent", status: "compatible", provider: "Custom", connect: "mcp", evidence: viaProxy("Cursor") },
  { id: "cline", name: "Cline", logo: "cline", category: "agent", status: "compatible", provider: "Custom", connect: "mcp", evidence: viaProxy("Cline") },
  { id: "aider", name: "Aider", category: "agent", status: "planned" },

  { id: "langchain", name: "LangChain", logo: "langchain", category: "framework", status: "planned" },
  { id: "langgraph", name: "LangGraph", logo: "langgraph", category: "framework", status: "planned" },
  { id: "crewai", name: "CrewAI", logo: "crewai", category: "framework", status: "planned" },
  { id: "autogen", name: "AutoGen", category: "framework", status: "planned" },
  { id: "pydanticAi", name: "PydanticAI", category: "framework", status: "planned" },
  { id: "mastra", name: "Mastra", category: "framework", status: "planned" },

  { id: "mcp", name: "Model Context Protocol", logo: "modelcontextprotocol", category: "protocol", status: "compatible", provider: "Custom", connect: "mcp", evidence: MCP_PROXY },
  { id: "http", name: "HTTP API", category: "protocol", status: "verified", provider: "Custom", connect: "http",
    evidence: { kind: "real-protocol", date: DATE, test: "docs/api-examples.md run as written against a running TEND; npm run e2e:connect (8/8)" } },
  { id: "openaiCompatible", name: "OpenAI-compatible API", category: "protocol", status: "planned" },
];

export const STATUS_ORDER: IntegrationStatus[] = ["verified", "compatible", "planned"];

/** What this TEND has seen of an integration: how many connected agents use it, and when one last ran an action TEND had authorized. */
export function liveStatus(entry: Integration, agents: Pick<Agent, "id" | "origin" | "provider">[], events: Pick<TaskEvent, "agentId" | "type" | "outcome" | "authorizationId" | "at">[]) {
  if (!entry.provider || entry.status === "planned") return { count: 0, lastVerifiedAt: null as number | null };
  const ids = new Set(agents.filter((a) => a.origin === "connected" && a.provider === entry.provider).map((a) => a.id));
  let lastVerifiedAt: number | null = null;
  for (const e of events) if (ids.has(e.agentId) && e.type === "tool.called" && e.outcome === "success" && e.authorizationId && (lastVerifiedAt === null || e.at > lastVerifiedAt)) lastVerifiedAt = e.at;
  return { count: ids.size, lastVerifiedAt };
}

/** Search over the name, the id ("mcp"), the shown summary and the category, case-insensitive. */
export const matches = (entry: Integration, summary: string, q: string) => {
  const s = q.trim().toLowerCase();
  return !s || entry.name.toLowerCase().includes(s) || entry.id.toLowerCase().includes(s) || summary.toLowerCase().includes(s) || entry.category.includes(s);
};
