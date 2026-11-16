import { listPendingApprovals } from "@/server/approvals";
import { getDb } from "@/server/db";
import { json, requireOperator, route } from "@/server/http";

/** The approvals waiting for a person in the caller's workspace. Every channel (dashboard, notifications, a native app later) reads this list. */
export const GET = route(async (req) => {
  const db = await getDb();
  const s = await requireOperator(req, db);
  return json({ approvals: await listPendingApprovals(db, s.workspace) });
});
