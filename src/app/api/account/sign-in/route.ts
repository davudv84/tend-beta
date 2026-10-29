import { passwordSignIn } from "@/server/accounts";
import { getDb } from "@/server/db";
import { json, readJson, requireSameSite, route } from "@/server/http";
import { sessionHeader } from "@/server/session";

/** E-mail and password for a session cookie (HttpOnly, SameSite=Strict, Secure in production). Sign out: DELETE /api/operator/session. */
export const POST = route(async (req) => {
  requireSameSite(req);
  const s = await passwordSignIn(await getDb(), req, await readJson(req, 2_000));
  return json({ ok: true }, 200, { "set-cookie": sessionHeader(s.value, s.ttl, req) });
});
