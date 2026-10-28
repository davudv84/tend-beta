import { getDb } from "@/server/db";
import { json, readJson, requireOperator, route } from "@/server/http";
import { decide } from "@/server/repo";

/** Records a human decision on a review. Approving a permission request grants it and bumps the config version. */
export const POST = route(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const by = await requireOperator(req, await getDb());
  const { id } = await params;
  const body = (await readJson(req)) as { status?: string; note?: string };
  return json({ events: await decide(await getDb(), id, body?.status as "approved", typeof body?.note === "string" ? body.note : undefined, by) });
});
