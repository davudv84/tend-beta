import { authAgent } from "@/server/agent-auth";
import { consumeAuthorization } from "@/server/authz";
import { getDb } from "@/server/db";
import { json, readJson, route } from "@/server/http";

/**
 * Spend the token immediately before acting; act only on a 200. Body: { token, tool, action, resource?, detail? },
 * which must repeat exactly what was approved. Any other response, or none, means do not act.
 */
export const POST = route(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const db = await getDb();
  const agent = await authAgent(db, req);
  return json(await consumeAuthorization(db, agent, (await params).id, await readJson(req)));
});
