import { getDb } from "@/server/db";
import { json, readJson, requireOperator, route } from "@/server/http";
import { updateCentralPolicy } from "@/server/repo";

/** Changes a central policy's rules: { rules, expectedVersion? }. Takes effect for every assigned agent at once. Operators only. */
export const POST = route(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const db = await getDb();
  const by = await requireOperator(req, db);
  const { id } = await params;
  return json({ centralPolicy: await updateCentralPolicy(db, id, await readJson(req), by) });
});
