import { getDb } from "@/server/db";
import { json, readJson, requireOperator, route } from "@/server/http";
import { createCentralPolicy, listCentralPolicies } from "@/server/repo";

/** Every central policy with its rules and the agents assigned to it. Operators only: a policy is not for visitors. */
export const GET = route(async (req) => {
  const db = await getDb();
  await requireOperator(req, db);
  return json({ centralPolicies: await listCentralPolicies(db) });
});

/** Creates a central policy: { name, rules }. Validated like an agent's own policy; assigned to nobody yet. Operators only. */
export const POST = route(async (req) => {
  const db = await getDb();
  const by = await requireOperator(req, db);
  return json({ centralPolicy: await createCentralPolicy(db, await readJson(req), by) }, 201);
});
