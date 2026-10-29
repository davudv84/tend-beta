import { getDb } from "@/server/db";
import { json, requireOperator, route } from "@/server/http";
import { agentInWorkspace, requestCheckIn } from "@/server/repo";

/** Asks an agent for a check-in. Connected agents receive it through their inbox. */
export const POST = route(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const db = await getDb();
  const { id: by, workspace } = await requireOperator(req, db);
  const { id } = await params;
  await agentInWorkspace(db, workspace, id);
  return json({ event: await requestCheckIn(db, id, by) }, 201);
});
