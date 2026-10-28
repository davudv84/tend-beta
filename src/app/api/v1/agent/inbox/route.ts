import { authAgent } from "@/server/agent-auth";
import { getDb } from "@/server/db";
import { json, route } from "@/server/http";
import { inbox } from "@/server/repo";

/** What the agent should know: its configuration (status, permissions, version) and pending human requests. */
export const GET = route(async (req) => {
  const db = await getDb();
  const agent = await authAgent(db, req);
  return json({ agentId: agent.id, ...(await inbox(db, agent)) });
});
