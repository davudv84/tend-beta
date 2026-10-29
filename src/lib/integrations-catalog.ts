// Every way to put TEND in front of an agent, with what each claim rests on. "verified" means a real connection was tested end to end and the
// evidence says which; "compatible" means built and tested against stand-ins only; "planned" means nothing is built or tested. A test keeps
// "verified" honest: it is refused without real-connection evidence. Texts shown to people live in the dictionaries (integrations.items).
import type { Agent, Provider, TaskEvent } from "./types";

export type IntegrationStatus = "verified" | "compatible" | "planned";
export type IntegrationCategory = "sdk" | "protocol" | "api" | "framework";
export type ConnectKind = "claude" | "openai" | "mcp" | "http";
export interface Evidence {
  /** real-model: a real provider API; protocol: the real protocol with a scripted client; mocked: the provider's API replaced by a stand-in. */
  kind: "real-model" | "real-protocol" | "protocol" | "mocked";
  date: string;
  /** The test or run, as a command or file, so anyone can repeat it. */
  test: string;
}
export interface Integration {
  id: "claude" | "http" | "openai" | "mcp" | "hermes" | "gemini";
  name: string;
  monogram: string;
  category: IntegrationCategory;
  status: IntegrationStatus;
  /** What an agent using it is registered as in TEND. */
  provider?: Provider;
  evidence?: Evidence;
  /** Which instructions the connect flow shows. Absent for planned integrations: they cannot be connected yet. */
  connect?: ConnectKind;
}

export const INTEGRATIONS: Integration[] = [
  { id: "claude", name: "Claude (Anthropic SDK)", monogram: "A", category: "sdk", status: "verified", provider: "Anthropic", connect: "claude",
    evidence: { kind: "real-model", date: "2026-10-29", test: "npm run e2e:real-claude (Claude Haiku 4.5: allow, deny, approve, reject, revoke, 5/5) and npm run demo:cross" } },
  { id: "http", name: "Any agent over HTTP", monogram: "{ }", category: "api", status: "verified", provider: "Custom", connect: "http",
    evidence: { kind: "real-protocol", date: "2026-10-29", test: "docs/api-examples.md run as written against a running TEND; npm run e2e:connect (8/8)" } },
  { id: "openai", name: "OpenAI Agents SDK", monogram: "O", category: "sdk", status: "compatible", provider: "OpenAI", connect: "openai",
    evidence: { kind: "mocked", date: "2026-10-29", test: "src/server/real-agents.test.ts: the official SDK against a mocked Responses API (10 tests). No real-API run yet." } },
  { id: "mcp", name: "MCP servers (any MCP host)", monogram: "M", category: "protocol", status: "compatible", provider: "Custom", connect: "mcp",
    evidence: { kind: "protocol", date: "2026-10-29", test: "src/server/mcp-proxy.test.ts: a real MCP server process and a scripted MCP client (8 tests). No real MCP host yet." } },
  { id: "hermes", name: "Hermes Agent", monogram: "H", category: "framework", status: "planned" },
  { id: "gemini", name: "Google Gemini", monogram: "G", category: "sdk", status: "planned", provider: "Google" },
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

/** Search over the name and the shown summary, case-insensitive. */
export const matches = (entry: Integration, summary: string, q: string) => {
  const s = q.trim().toLowerCase();
  return !s || entry.name.toLowerCase().includes(s) || summary.toLowerCase().includes(s) || entry.category.includes(s);
};
