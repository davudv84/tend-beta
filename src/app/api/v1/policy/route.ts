import { getDb } from "@/server/db";
import { json, readJson, requireOperator, route } from "@/server/http";
import { setPolicyMany } from "@/server/repo";

/**
 * One policy for several agents at once: { agents: [id, ...], rules: [...], enforcement?: "monitor" | "enforce" }. Validated once and applied
 * to all of them or none. Each agent keeps its own stored policy and key; each gets its own audit event. Operators only.
 */
export const POST = route(async (req) => {
  const by = await requireOperator(req, await getDb());
  const body = (await readJson(req)) as { agents?: unknown; rules?: unknown; enforcement?: unknown } | null;
  return json({ events: await setPolicyMany(await getDb(), body?.agents, body?.rules, body?.enforcement, by) });
});
