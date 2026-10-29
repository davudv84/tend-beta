import { resetPassword } from "@/server/accounts";
import { getDb } from "@/server/db";
import { json, readJson, requireSameSite, route } from "@/server/http";

/** A new password from a reset link. Every session of the account ends. */
export const POST = route(async (req) => {
  requireSameSite(req);
  return json(await resetPassword(await getDb(), await readJson(req, 2_000)));
});
