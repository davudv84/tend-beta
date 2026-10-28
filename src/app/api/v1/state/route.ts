import { viewerOf } from "@/server/session";
import { getDb } from "@/server/db";
import { clientIp, json, limit, route } from "@/server/http";
import { snapshot } from "@/server/sync";

/** Full snapshot for the UI. Public instances serve it to visitors, without private agents. */
export const GET = route(async (req) => {
  const db = await getDb();
  const viewer = await viewerOf(db, req);
  if (viewer.role === "visitor") await limit(db, `read:${clientIp(req)}`, 30);
  return json(await snapshot(db, viewer));
});
