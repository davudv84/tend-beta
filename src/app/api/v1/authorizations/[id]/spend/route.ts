import { authAgent } from "@/server/agent-auth";
import { spendApproved } from "@/server/authz";
import { getDb } from "@/server/db";
import { json, readJson, route } from "@/server/http";

/** Spends an approved authorization, once: the body repeats the exact request. Act only on a 200. */
export const POST = route(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const db = await getDb();
  const agent = await authAgent(db, req);
  return json(await spendApproved(db, agent, (await params).id, await readJson(req)));
});
