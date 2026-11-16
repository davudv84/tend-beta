import { resolveApproval } from "@/server/approvals";
import { getDb } from "@/server/db";
import { HttpError, json, readJson, requireOperator, route } from "@/server/http";
import { decide, reviewInWorkspace } from "@/server/repo";

/**
 * Records a human decision on a review. Approving a permission request grants it and bumps the config version.
 * A review that is an approval (an authorization waiting for a person) is decided by resolveApproval, like every other channel, as a decision
 * made in the dashboard. This route keeps its own answer for a second decision: 409, as the dashboard and the command line expect.
 */
export const POST = route(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const db = await getDb();
  const s = await requireOperator(req, db);
  const { id } = await params;
  await reviewInWorkspace(db, s.workspace, id);
  const body = (await readJson(req)) as { status?: string; note?: string };
  const note = typeof body?.note === "string" ? body.note : undefined;
  if ((body?.status === "approved" || body?.status === "rejected") && await db.get("SELECT 1 FROM authorizations WHERE id = ?", id)) {
    const r = await resolveApproval(db, { id, decision: body.status === "approved" ? "approve" : "deny", via: "dashboard", actor: { workspace: s.workspace, userId: s.userId, by: s.id }, note });
    if (!r.changed) throw r.approval.status === "expired" || r.approval.status === "cancelled"
      ? new HttpError(409, "expired", "This request is no longer waiting for a decision.")
      : new HttpError(409, "already_decided", `This review was already ${r.approval.status === "approved" ? "approved" : "rejected"}.`);
    return json({ events: r.events });
  }
  return json({ events: await decide(db, id, body?.status as "approved", note, s.id) });
});
