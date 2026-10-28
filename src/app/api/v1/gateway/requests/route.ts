import { authAgent } from "@/server/agent-auth";
import { getDb } from "@/server/db";
import { requestExecution } from "@/server/gateway";
import { json, limit, readJson, route } from "@/server/http";

/**
 * Ask to run a gateway tool: { tool, params }. Tend validates the params and derives what a person approves from them.
 * 201 approved or pending, 200 a repeat (same Idempotency-Key), 403 denied, 404 unknown tool, 422 invalid params.
 */
export const POST = route(async (req) => {
  const db = await getDb();
  const agent = await authAgent(db, req);
  await limit(db, `gateway:${agent.id}`, 30);
  const { view, created } = await requestExecution(db, agent, await readJson(req, 4_096), req.headers.get("idempotency-key"));
  return json(view, view.status === "denied" ? 403 : created ? 201 : 200);
});
