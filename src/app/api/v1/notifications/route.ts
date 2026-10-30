import { getDb } from "@/server/db";
import { afterResponse, json, requireOperator, route } from "@/server/http";
import { listNotifications, pushStatus } from "@/server/notifications";
import { flushPush } from "@/server/push";

/** This workspace's notifications, newest first, with the unread count and whether browser notifications can be sent. */
export const GET = route(async (req) => {
  const db = await getDb();
  const s = await requireOperator(req, db);
  // A browser notification queued by a request that ended before it could deliver goes out on the next look.
  if (await db.get("SELECT 1 FROM notifications WHERE push = 'queued' LIMIT 1")) await afterResponse(() => flushPush(db));
  return json({ ...(await listNotifications(db, s.workspace)), push: await pushStatus(db, s.userId) });
});
