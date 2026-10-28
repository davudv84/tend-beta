import { getDb } from "@/server/db";
import { json, requireOperator, route } from "@/server/http";
import { requestCheckIn } from "@/server/repo";

/** Asks an agent for a check-in. Connected agents receive it through their inbox. */
export const POST = route(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const by = await requireOperator(req, await getDb());
  const { id } = await params;
  return json({ event: await requestCheckIn(await getDb(), id, by) }, 201);
});
