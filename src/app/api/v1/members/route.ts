import { after } from "next/server";
import { deliver } from "@/server/accounts";
import { getDb } from "@/server/db";
import { json, readJson, requireOperator, route } from "@/server/http";
import { inviteMember, listMembers } from "@/server/members";

/** The workspace's members and their roles. Any member may look. */
export const GET = route(async (req) => {
  const db = await getDb();
  const s = await requireOperator(req, db, "view");
  return json({ members: await listMembers(db, s.workspace), you: { id: s.userId, role: s.role } });
});

/** Invites someone: { email, role }. Admins and owners; nobody gives a role above their own. The invitation mail goes out after the answer. */
export const POST = route(async (req) => {
  const db = await getDb();
  const s = await requireOperator(req, db, "members");
  const { member, outbox } = await inviteMember(db, req, s, await readJson(req, 1_000));
  after(() => deliver(outbox));
  return json({ member }, 201);
});
