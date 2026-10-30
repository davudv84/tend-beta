import { getDb } from "@/server/db";
import { json, limit, requireOperator, route } from "@/server/http";
import { createTestNotification } from "@/server/notifications";
import { flushPush } from "@/server/push";

/** Adds a test notification to this workspace and, where browser notifications are set up, sends it now and says what happened. */
export const POST = route(async (req) => {
  const db = await getDb();
  const s = await requireOperator(req, db);
  await limit(db, `notify-test:${s.id}`, 5);
  await db.tx((q) => createTestNotification(q, s.workspace));
  return json({ created: true, push: await flushPush(db) });
});
