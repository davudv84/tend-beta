// The shape of GET /api/v1/integrations/status (src/server/integrations.ts), shared with the Integrations page.
// Everything in it is read from the server's own records. There is deliberately no field for a path, key or token.

export type ProviderKey = "OpenAI" | "Anthropic";

export interface IntegrationAgent {
  id: string;
  name: string;
  keyActive: boolean;
  lastSeenAt: number | null;
  seenRecently: boolean;
  enforcement: "monitor" | "enforce";
  /** The decision the server would make for each sandbox tool: allow | approve | deny. */
  policy: Record<"read_test_file" | "write_test_file" | "delete_test_file", string>;
  policyAsRecommended: boolean;
  gateway: { successes: number; denied: number; last: number | null };
}

export interface IntegrationStatus {
  sandbox: { configured: boolean; usable: boolean };
  tools: { tool: string; risk: string; available: boolean }[];
  providers: Record<ProviderKey, IntegrationAgent[]>;
}

export type ConnectionState = "not_registered" | "key_revoked" | "waiting" | "connected" | "quiet";

/** One word for a provider's state, from its agents. The best state among them wins, so one working agent is "connected". */
export function connectionState(agents: IntegrationAgent[]): ConnectionState {
  if (agents.length === 0) return "not_registered";
  const live = agents.filter((a) => a.keyActive);
  if (live.length === 0) return "key_revoked";
  if (live.some((a) => a.seenRecently)) return "connected";
  return live.some((a) => a.lastSeenAt) ? "quiet" : "waiting";
}
