import { getDb } from "@/server/db";
import { json, readJson, requireOperator, route } from "@/server/http";
import { assignCentralPolicy } from "@/server/repo";

/** Assigns this central policy to agents and/or removes it: { assign: [ids], unassign: [ids] }. All or nothing. Operators only. */
export const POST = route(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const db = await getDb();
  const by = await requireOperator(req, db);
  const { id } = await params;
  return json({ centralPolicy: await assignCentralPolicy(db, id, await readJson(req), by) });
});
