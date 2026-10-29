import { listUsers } from "@/server/accounts";
import { getDb } from "@/server/db";
import { json, requireAdmin, route } from "@/server/http";

/** Every account and its state, for the admin's beta access page. No password hash or token leaves the server. */
export const GET = route(async (req) => {
  const db = await getDb();
  await requireAdmin(req, db);
  return json({ users: await listUsers(db) });
});
