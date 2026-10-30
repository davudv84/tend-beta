import { getDb } from "@/server/db";
import { json, readJson, requireOperator, route } from "@/server/http";
import { getPrefs, setPrefs } from "@/server/notifications";

/** Which kinds this account also receives in the browser. Every kind is always listed in TEND itself. */
export const GET = route(async (req) => {
  const db = await getDb();
  return json(await getPrefs(db, (await requireOperator(req, db)).userId));
});

export const POST = route(async (req) => {
  const db = await getDb();
  const s = await requireOperator(req, db);
  return json(await setPrefs(db, s.userId, await readJson(req, 1_000)));
});
