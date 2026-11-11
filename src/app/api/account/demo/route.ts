import { demoSignIn } from "@/server/accounts";
import { getDb } from "@/server/db";
import { json, requireSameSite, route } from "@/server/http";
import { sessionHeader } from "@/server/session";

// The demo's first sign-in writes its sample workspace (demo-account.ts), as the password sign-in does.
export const maxDuration = 60;

/** One click into the read-only demo account (accounts.ts demoSignIn). Same-site only, like every sign-in. */
export const POST = route(async (req) => {
  requireSameSite(req);
  const s = await demoSignIn(await getDb(), req);
  return json({ ok: true }, 200, { "set-cookie": sessionHeader(s.value, s.ttl, req) });
});
