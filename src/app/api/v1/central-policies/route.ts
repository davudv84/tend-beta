import { getDb } from "@/server/db";
import { json, readJson, requireOperator, route } from "@/server/http";
import { createCentralPolicy, listCentralPolicies } from "@/server/repo";

/** Every central policy with its rules and the agents assigned to it. Operators only: a policy is not for visitors. */
export const GET = route(async (req) => {
  const db = await getDb();
  const { workspace } = await requireOperator(req, db);
  return json({ centralPolicies: await listCentralPolicies(db, workspace) });
});

/** Creates a central policy: { name, rules }. Validated like an agent's own policy; assigned to nobody yet. Operators only. */
export const POST = route(async (req) => {
  const db = await getDb();
  const { id: by, workspace } = await requireOperator(req, db);
  return json({ centralPolicy: await createCentralPolicy(db, await readJson(req), by, workspace) }, 201);
});
