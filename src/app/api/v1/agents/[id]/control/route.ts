import { getDb } from "@/server/db";
import { json, readJson, requireOperator, route } from "@/server/http";
import { control } from "@/server/repo";

/** Pause, resume, disable or enable an agent. Bumps its configuration version. */
export const POST = route(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const by = await requireOperator(req, await getDb());
  const { id } = await params;
  const body = (await readJson(req)) as { action?: string; note?: string };
  const event = await control(await getDb(), id, body?.action as "pause", typeof body?.note === "string" ? body.note : undefined, by);
  return json({ event });
});
