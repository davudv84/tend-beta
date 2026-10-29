import { getDb } from "@/server/db";
import { json, readJson, requireOperator, route } from "@/server/http";
import { centralInWorkspace, updateCentralPolicy } from "@/server/repo";

/** Changes a central policy's rules: { rules, expectedVersion? }. Takes effect for every assigned agent at once. Operators only. */
export const POST = route(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const db = await getDb();
  const { id: by, workspace } = await requireOperator(req, db);
  const { id } = await params;
  await centralInWorkspace(db, workspace, id);
  return json({ centralPolicy: await updateCentralPolicy(db, id, await readJson(req), by) });
});
