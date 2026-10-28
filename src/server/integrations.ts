// What the Integrations page shows about real AI-provider agents. Every field is read from this server's own records
// (the environment, the database, the event log). Nothing is self-reported by an agent, and nothing here can see the
// provider's API key: that lives in the agent's own process, and the page says so instead of guessing.
// No path, key, token or file content is returned: the sandbox is described by two booleans.
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import type { Q } from "./db.ts";
import { toolCatalog } from "./gateway.ts";
import { policyView } from "./permissions.ts";
import type { IntegrationAgent, IntegrationStatus, ProviderKey } from "../lib/integrations.ts";
import { allAgents } from "./repo.ts";

/** The policy the guided examples set. Anything else is shown as "different", not as an error. */
export const RECOMMENDED = { read_test_file: "allow", write_test_file: "approve", delete_test_file: "deny" } as const;
const SEEN_WITHIN = 10 * 60_000;

export async function integrationStatus(q: Q, now = Date.now()): Promise<IntegrationStatus> {
  const dir = process.env.TEND_GATEWAY_SANDBOX_DIR ?? "";
  const configured = path.isAbsolute(dir);
  let usable = false;
  if (configured) {
    try {
      usable = (await stat(dir)).isDirectory();
      await access(dir, constants.R_OK | constants.W_OK);
    } catch {
      usable = false;
    }
  }
  const tools = toolCatalog().filter((t) => t.tool in RECOMMENDED).map((t) => ({ tool: t.tool, risk: t.risk, available: t.available }));

  const connected = (await allAgents(q)).filter((a) => a.origin === "connected");
  const providers: Record<ProviderKey, IntegrationAgent[]> = { OpenAI: [], Anthropic: [] };
  for (const a of connected) {
    if (a.provider !== "OpenAI" && a.provider !== "Anthropic") continue;
    const view = await policyView(q, a.id);
    const policy = Object.fromEntries(Object.keys(RECOMMENDED).map((tool) => [tool, view.valid ? (view.tools.find((t) => t.tool === tool)?.effect ?? "deny") : "deny"])) as IntegrationAgent["policy"];
    const key = await q.get<{ has: number }>("SELECT CASE WHEN key_hash IS NULL THEN 0 ELSE 1 END AS has FROM agents WHERE id = ?", a.id);
    const g = await q.all<{ outcome: string | null; at: number }>(
      "SELECT (data::jsonb)->>'outcome' AS outcome, at FROM events WHERE agent_id = ? AND type = 'tool.called' AND (data::jsonb)->>'via' = 'gateway' ORDER BY seq DESC LIMIT 500", a.id);
    providers[a.provider].push({
      id: a.id, name: a.name, keyActive: !!key?.has, lastSeenAt: a.lastSeenAt ?? null, seenRecently: !!a.lastSeenAt && now - a.lastSeenAt < SEEN_WITHIN,
      enforcement: view.enforcement, policy, policyAsRecommended: view.valid && Object.entries(RECOMMENDED).every(([t, e]) => policy[t as keyof typeof RECOMMENDED] === e),
      gateway: { successes: g.filter((e) => e.outcome === "success").length, denied: g.filter((e) => e.outcome === "denied").length, last: g[0] ? Number(g[0].at) : null },
    });
  }
  return { sandbox: { configured, usable }, tools, providers };
}
