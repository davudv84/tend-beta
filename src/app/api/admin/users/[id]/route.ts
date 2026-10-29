import { after } from "next/server";
import { deliver, setAccess } from "@/server/accounts";
import { getDb } from "@/server/db";
import { json, readJson, requireAdmin, route } from "@/server/http";

/** { action: "approve" | "disable" | "enable" }. Approving mails the user; disabling ends their sessions at once. */
export const POST = route(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const db = await getDb();
  const { id: by } = await requireAdmin(req, db);
  const { id } = await params;
  const body = (await readJson(req, 1_000)) as { action?: unknown } | null;
  const { user, outbox } = await setAccess(db, req, id, body?.action, by);
  after(() => deliver(outbox));
  return json({ user });
});
