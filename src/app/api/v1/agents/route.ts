import { getDb } from "@/server/db";
import { json, readJson, requireOperator, route } from "@/server/http";
import { registerAgent } from "@/server/repo";

/** Registers a connected agent. The API key is returned once and never stored in plain text. */
export const POST = route(async (req) => {
  const db = await getDb();
  const { id: by, workspace } = await requireOperator(req, db);
  return json(await registerAgent(db, await readJson(req), by, workspace), 201);
});
