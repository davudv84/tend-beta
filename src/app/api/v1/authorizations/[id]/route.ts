import { authAgent } from "@/server/agent-auth";
import { authorizationStatus } from "@/server/authz";
import { getDb } from "@/server/db";
import { json, route } from "@/server/http";

/** The current status of one of the calling agent's authorizations. Never returns a token. */
export const GET = route(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const db = await getDb();
  const agent = await authAgent(db, req);
  return json(await authorizationStatus(db, agent, (await params).id));
});
