import { getDb } from "@/server/db";
import { json, readJson, requireOperator, route } from "@/server/http";
import { decide, reviewInWorkspace } from "@/server/repo";

/** Records a human decision on a review. Approving a permission request grants it and bumps the config version. */
export const POST = route(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const db = await getDb();
  const { id: by, workspace } = await requireOperator(req, db);
  const { id } = await params;
  await reviewInWorkspace(db, workspace, id);
  const body = (await readJson(req)) as { status?: string; note?: string };
  return json({ events: await decide(db, id, body?.status as "approved", typeof body?.note === "string" ? body.note : undefined, by) });
});
