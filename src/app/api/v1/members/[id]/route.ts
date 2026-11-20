import { getDb } from "@/server/db";
import { json, readJson, requireOperator, route } from "@/server/http";
import { removeMember, setMemberRole } from "@/server/members";

/** Changes a member's role: { role }. Applies to their next request (the role is read from the account each time). */
export const PATCH = route(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const db = await getDb();
  const s = await requireOperator(req, db, "members");
  const { id } = await params;
  const body = (await readJson(req, 500)) as { role?: unknown } | null;
  return json({ member: await setMemberRole(db, s, id, body?.role) });
});

/** Removes a member from the workspace: their sessions end at once. Agents and keys stay with the workspace. */
export const DELETE = route(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const db = await getDb();
  const s = await requireOperator(req, db, "members");
  const { id } = await params;
  return json(await removeMember(db, s, id));
});
