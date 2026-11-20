import { asSystem } from "@/server/db-context";
import { getDb } from "@/server/db";
import { json, readJson, requireSameSite, route } from "@/server/http";
import { acceptInvitation } from "@/server/members";

/** Accepts a workspace invitation with the mailed one-time link: { token, password }. Creates the account; sign in afterwards. */
export const POST = route(async (req) => {
  requireSameSite(req);
  return json(await asSystem(async () => acceptInvitation(await getDb(), await readJson(req, 1_000))));
});
