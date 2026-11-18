import { getDb } from "@/server/db";
import { json, readJson, requireOperator, route } from "@/server/http";
import { agentInWorkspace, revokeKey, rotateKey } from "@/server/repo";

/** Issues a new API key. The old one stops working at once, and what it had waiting for approval is cancelled. */
export const POST = route(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const db = await getDb();
  const { id: by, workspace } = await requireOperator(req, db);
  const { id } = await params;
  await agentInWorkspace(db, workspace, id);
  // Optional { "keyExpiresInDays": 1–3650 }; no body at all is fine.
  const body = (req.headers.get("content-length") ?? "0") === "0" ? {} : ((await readJson(req, 2_000)) as { keyExpiresInDays?: unknown } | null) ?? {};
  return json(await rotateKey(db, id, by, body.keyExpiresInDays), 201);
});

/** Takes the key away without issuing another. The agent can no longer authenticate until a new key is issued. */
export const DELETE = route(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const db = await getDb();
  const { id: by, workspace } = await requireOperator(req, db);
  const { id } = await params;
  await agentInWorkspace(db, workspace, id);
  return json(await revokeKey(db, id, by));
});
