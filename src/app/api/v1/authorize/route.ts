import { authAgent } from "@/server/agent-auth";
import { requestAuthorization } from "@/server/authz";
import { getDb } from "@/server/db";
import { json, readJson, route } from "@/server/http";

/**
 * One round trip: { tool, action, resource?, detail?, args? }. 200 status "consumed": authorized and spent, act now, once. 202 status
 * "pending": a person decides; poll GET /authorizations/{id}, then POST /authorizations/{id}/spend. 403: denied. Anything else: do not act.
 * With an Idempotency-Key, a repeat of a spent request is refused (409), never authorized twice.
 */
export const POST = route(async (req) => {
  const db = await getDb();
  const agent = await authAgent(db, req);
  const { view } = await requestAuthorization(db, agent, await readJson(req), req.headers.get("idempotency-key"), Date.now(), { spend: true });
  const status = view.status as string;
  return json({ ...view, authorized: status === "consumed" }, status === "consumed" ? 200 : status === "pending" ? 202 : status === "denied" ? 403 : 409);
});
