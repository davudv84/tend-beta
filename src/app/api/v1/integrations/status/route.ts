import { getDb } from "@/server/db";
import { json, requireOperator, route } from "@/server/http";
import { integrationStatus } from "@/server/integrations";

/** Real evidence for the Integrations page: sandbox setup, registered OpenAI/Anthropic agents, their policy and gateway activity. Operators only. */
export const GET = route(async (req) => {
  const db = await getDb();
  const { workspace } = await requireOperator(req, db);
  return json(await integrationStatus(db, workspace));
});
