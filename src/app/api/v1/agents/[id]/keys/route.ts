import { getDb } from "@/server/db";
import { json, requireOperator, route } from "@/server/http";
import { revokeKey, rotateKey } from "@/server/repo";

/** Issues a new API key. The old one stops working at once, and what it had waiting for approval is cancelled. */
export const POST = route(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const by = await requireOperator(req, await getDb());
  const { id } = await params;
  return json(await rotateKey(await getDb(), id, by), 201);
});

/** Takes the key away without issuing another. The agent can no longer authenticate until a new key is issued. */
export const DELETE = route(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const by = await requireOperator(req, await getDb());
  const { id } = await params;
  return json(await revokeKey(await getDb(), id, by));
});
