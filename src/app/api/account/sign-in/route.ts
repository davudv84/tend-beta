import { passwordSignIn } from "@/server/accounts";
import { getDb } from "@/server/db";
import { json, readJson, requireSameSite, route } from "@/server/http";
import { sessionHeader } from "@/server/session";

// The demo account's first sign-in also writes its sample workspace (demo-account.ts), a few hundred statements against a remote database.
export const maxDuration = 60;

/** E-mail and password for a session cookie (HttpOnly, SameSite=Strict, Secure in production). Sign out: DELETE /api/operator/session. */
export const POST = route(async (req) => {
  requireSameSite(req);
  const s = await passwordSignIn(await getDb(), req, await readJson(req, 2_000));
  return json({ ok: true }, 200, { "set-cookie": sessionHeader(s.value, s.ttl, req) });
});
