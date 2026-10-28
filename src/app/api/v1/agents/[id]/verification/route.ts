import { getDb } from "@/server/db";
import { HttpError, json, limit, requireOperator, route } from "@/server/http";
import { getAgent } from "@/server/repo";
import { latestVerification, runVerification } from "@/server/verification";

/** The latest protection checks for a connected agent, or { run: null }. Operators only: the results describe weaknesses. */
export const GET = route(async (req, { params }: { params: Promise<{ id: string }> }) => {
  await requireOperator(req, await getDb());
  const { id } = await params;
  const db = await getDb();
  if (!(await getAgent(db, id))) throw new HttpError(404, "agent_not_found", `No agent with id “${id}”.`);
  return json({ run: await latestVerification(db, id) });
});

/** Runs the checks now (a few seconds), stores the result as evidence and returns it. Operators only; a few runs a minute at most. */
export const POST = route(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const by = await requireOperator(req, await getDb());
  const { id } = await params;
  const db = await getDb();
  await limit(db, `verify:${id}`, 4);
  return json({ run: await runVerification(db, id, by) }, 201);
});
