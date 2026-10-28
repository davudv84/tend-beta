import { authAgent } from "@/server/agent-auth";
import { getDb } from "@/server/db";
import { executeTool } from "@/server/gateway";
import { json, limit, readJson, route } from "@/server/http";

/**
 * Run a gateway tool once: { authorizationId, token, tool, params }, params exactly as approved. The gateway holds the
 * credential and returns only the tool's allowlisted result. 200 means it ran; anything else means do not assume it did.
 */
export const POST = route(async (req) => {
  const db = await getDb();
  const agent = await authAgent(db, req);
  await limit(db, `gateway:${agent.id}`, 30);
  return json(await executeTool(db, agent, await readJson(req, 4_096)));
});
