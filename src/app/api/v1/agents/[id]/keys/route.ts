import { getDb } from "@/server/db";
import { json, requireOperator, route } from "@/server/http";
import { agentInWorkspace, revokeKey, rotateKey } from "@/server/repo";

/** Issues a new API key. The old one stops working at once, and what it had waiting for approval is cancelled. */
export const POST = route(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const db = await getDb();
  const { id: by, workspace } = await requireOperator(req, db);
  const { id } = await params;
  await agentInWorkspace(db, workspace, id);
  return json(await rotateKey(db, id, by), 201);
});

/** Takes the key away without issuing another. The agent can no longer authenticate until a new key is issued. */
export const DELETE = route(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const db = await getDb();
  const { id: by, workspace } = await requireOperator(req, db);
  const { id } = await params;
  await agentInWorkspace(db, workspace, id);
  return json(await revokeKey(db, id, by));
});
