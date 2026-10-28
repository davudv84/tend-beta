import { getDb } from "@/server/db";
import { json, requireOperator, route } from "@/server/http";
import { revokeAll, sessionHeader, sessionOverview } from "@/server/session";

/** The live sessions and the latest sign-in activity. Nothing in it can be used to sign in. */
export const GET = route(async (req) => {
  const db = await getDb();
  return json(await sessionOverview(db, await requireOperator(req, db)));
});

/** "Sign out everywhere": every session, this one included, stops working at once. Sign in again with the admin token. */
export const DELETE = route(async (req) => {
  const db = await getDb();
  const by = await requireOperator(req, db);
  return json({ revoked: await revokeAll(db, by) }, 200, { "set-cookie": sessionHeader("", 0) });
});
