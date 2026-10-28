import { authAgent } from "@/server/agent-auth";
import { cancelAuthorization } from "@/server/authz";
import { getDb } from "@/server/db";
import { json, route } from "@/server/http";

/** The agent stops waiting. A pending request leaves the review queue; an approved one can no longer be used. */
export const POST = route(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const db = await getDb();
  const agent = await authAgent(db, req);
  return json(await cancelAuthorization(db, agent, (await params).id));
});
