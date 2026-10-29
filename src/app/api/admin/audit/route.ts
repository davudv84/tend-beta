import { verifyAudit } from "@/server/audit-chain";
import { getDb } from "@/server/db";
import { json, requireAdmin, route } from "@/server/http";

/** Checks the whole event log's hash chain. The admin only: the chain spans every workspace. */
export const GET = route(async (req) => {
  const db = await getDb();
  await requireAdmin(req, db);
  return json(await verifyAudit(db));
});
