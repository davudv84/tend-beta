import { getDb } from "@/server/db";
import { json, readJson, requireOperator, route } from "@/server/http";
import { registerAgent } from "@/server/repo";

/** Registers a connected agent. The API key is returned once and never stored in plain text. */
export const POST = route(async (req) => {
  const by = await requireOperator(req, await getDb());
  return json(await registerAgent(await getDb(), await readJson(req), by), 201);
});
