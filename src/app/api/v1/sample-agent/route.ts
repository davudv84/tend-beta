import { getDb } from "@/server/db";
import { HttpError, json, readJson, requireOperator, route } from "@/server/http";
import { continueSample, startSample } from "@/server/sample-agent";

/**
 * The simulated sample agent, for trying TEND in the browser: { step: "start" } asks for three harmless demo actions;
 * { step: "continue", ids } carries on after a person decided; { step: "status", ids } only reports. Operators only; nothing real ever runs.
 */
export const POST = route(async (req) => {
  const db = await getDb();
  const { id: by, workspace } = await requireOperator(req, db);
  const body = (await readJson(req)) as { step?: unknown; ids?: unknown } | null;
  if (body?.step === "start") return json({ steps: await startSample(db, by, workspace) });
  if (body?.step === "continue") return json({ steps: await continueSample(db, body.ids, true, workspace) });
  if (body?.step === "status") return json({ steps: await continueSample(db, body.ids, false, workspace) });
  throw new HttpError(422, "invalid_step", 'step must be "start", "continue" or "status".');
});
