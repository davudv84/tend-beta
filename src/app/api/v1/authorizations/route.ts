import { authAgent } from "@/server/agent-auth";
import { requestAuthorization } from "@/server/authz";
import { getDb } from "@/server/db";
import { json, readJson, route } from "@/server/http";

/**
 * Ask Tend before doing something sensitive. 201 approved or pending, 200 a repeat of an earlier request,
 * 403 denied (with a reason code). Act only after a successful consume, never on this response alone.
 */
export const POST = route(async (req) => {
  const db = await getDb();
  const agent = await authAgent(db, req);
  const { view, created } = await requestAuthorization(db, agent, await readJson(req), req.headers.get("idempotency-key"));
  return json(view, view.status === "denied" ? 403 : created ? 201 : 200);
});
