import { getDb } from "@/server/db";
import { json, readJson, requireOperator, route } from "@/server/http";
import { agentInWorkspace, control } from "@/server/repo";

/** Pause, resume, disable or enable an agent. Bumps its configuration version. */
export const POST = route(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const db = await getDb();
  const { id: by, workspace } = await requireOperator(req, db);
  const { id } = await params;
  await agentInWorkspace(db, workspace, id);
  const body = (await readJson(req)) as { action?: string; note?: string };
  const event = await control(db, id, body?.action as "pause", typeof body?.note === "string" ? body.note : undefined, by);
  return json({ event });
});
