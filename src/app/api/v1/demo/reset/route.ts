import { getDb } from "@/server/db";
import { resetDemo } from "@/server/demo";
import { json, requireAdmin, route } from "@/server/http";

/** Re-seeds the demo agents' history. Connected agents and their events are untouched. */
export const POST = route(async (req) => {
  await requireAdmin(req, await getDb());
  await resetDemo(await getDb(), Date.now());
  return json({ ok: true });
});
