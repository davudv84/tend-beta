import { getDb } from "@/server/db";
import { HttpError, json, readJson, requireOperator, route } from "@/server/http";
import { getAgent, ingestCheckIn } from "@/server/repo";

/** Lets an operator compose a check-in for a demo agent. Connected agents always speak for themselves. */
export const POST = route(async (req) => {
  await requireOperator(req, await getDb());
  const db = await getDb();
  const body = (await readJson(req)) as { agentId?: string };
  const agent = await getAgent(db, String(body?.agentId ?? ""));
  if (!agent) throw new HttpError(404, "agent_not_found", "No agent with that id.");
  if (agent.origin !== "demo") throw new HttpError(403, "connected_agent", "Only the agent itself can submit check-ins for a connected agent.");
  return json(await ingestCheckIn(db, agent, body, "human"), 201);
});
