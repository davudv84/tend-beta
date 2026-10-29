import { getDb } from "@/server/db";
import { json, limit, requireOperator, route } from "@/server/http";
import { agentInWorkspace } from "@/server/repo";
import { latestVerification, runVerification } from "@/server/verification";

/** The latest protection checks for a connected agent, or { run: null }. Operators only: the results describe weaknesses. */
export const GET = route(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const db = await getDb();
  const { workspace } = await requireOperator(req, db);
  const { id } = await params;
  await agentInWorkspace(db, workspace, id);
  return json({ run: await latestVerification(db, id) });
});

/** Runs the checks now (a few seconds), stores the result as evidence and returns it. Operators only; a few runs a minute at most. */
export const POST = route(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const db = await getDb();
  const { id: by, workspace } = await requireOperator(req, db);
  const { id } = await params;
  await agentInWorkspace(db, workspace, id);
  await limit(db, `verify:${id}`, 4);
  return json({ run: await runVerification(db, id, by) }, 201);
});
