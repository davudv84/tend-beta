import { getDb } from "@/server/db";
import { json, readJson, requireOperator, route } from "@/server/http";
import { assignCentralPolicy, centralInWorkspace } from "@/server/repo";

/** Assigns this central policy to agents and/or removes it: { assign: [ids], unassign: [ids] }. All or nothing. Operators only. */
export const POST = route(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const db = await getDb();
  const { id: by, workspace } = await requireOperator(req, db);
  const { id } = await params;
  await centralInWorkspace(db, workspace, id);
  return json({ centralPolicy: await assignCentralPolicy(db, id, await readJson(req), by) });
});
