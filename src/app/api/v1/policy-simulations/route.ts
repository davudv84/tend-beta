import { getDb } from "@/server/db";
import { json, limit, readJson, requireOperator, route } from "@/server/http";
import { simulatePolicy } from "@/server/simulate";

/** What a proposed policy would have decided for this workspace's recorded actions. Read-only: nothing runs, nothing is saved. */
export const POST = route(async (req) => {
  const db = await getDb();
  const { id, workspace } = await requireOperator(req, db);
  await limit(db, `simulate:${id}`, 20);
  return json(await simulatePolicy(db, await readJson(req, 64_000), workspace));
});
