import { getDb } from "@/server/db";
import { json, readJson, requireOperator, route } from "@/server/http";
import { markRead } from "@/server/notifications";

/** Marks notifications read: { ids: [...] } or { all: true }. Only this workspace's are touched. */
export const POST = route(async (req) => {
  const db = await getDb();
  const s = await requireOperator(req, db);
  return json({ updated: await markRead(db, s.workspace, await readJson(req, 8_000)) });
});
