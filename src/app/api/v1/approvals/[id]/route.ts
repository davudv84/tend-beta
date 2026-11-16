import { getApproval, resolveApproval } from "@/server/approvals";
import { getDb } from "@/server/db";
import { json, limit, readJson, requireOperator, route } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

/** One approval of the caller's workspace: what is asked, its risk, and what became of it (who decided, through which channel). */
export const GET = route(async (req, { params }: Ctx) => {
  const db = await getDb();
  const s = await requireOperator(req, db);
  return json({ approval: await getApproval(db, s.workspace, (await params).id) });
});

/**
 * Decides an approval: { decision: "approve" | "deny", via: "dashboard" | "web-push" | "telegram" }. A signed-in member of the approval's
 * workspace only. The first decision wins; a later call gets the same answer back with `alreadyDecided: true` and changes nothing.
 * Approving a high-risk approval with via other than "dashboard" is refused (403 confirmation_required): it is confirmed on its page.
 */
export const POST = route(async (req, { params }: Ctx) => {
  const db = await getDb();
  const s = await requireOperator(req, db);
  await limit(db, `approval-decide:${s.id}`, 120);
  const body = (await readJson(req, 2_000)) as { decision?: unknown; via?: unknown } | null;
  const r = await resolveApproval(db, { id: (await params).id, decision: body?.decision, via: body?.via, actor: { workspace: s.workspace, userId: s.userId, by: s.id } });
  return json({ approval: r.approval, changed: r.changed, alreadyDecided: !r.changed });
});
