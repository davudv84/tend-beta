import { getDb } from "@/server/db";
import { HttpError, json, readJson, route } from "@/server/http";
import { SESSION_TTL, sessionHeader, signOut, viewerOf } from "@/server/session";
import { signIn } from "@/server/signin";

export const GET = route(async (req) => json({ viewer: await viewerOf(await getDb(), req) }));

/**
 * Exchanges the admin token for a session. The session is a server-side record; the browser gets an HttpOnly cookie holding a random
 * secret, and the token never reaches page scripts afterwards. Failures are counted per trusted address and written to the log.
 */
export const POST = route(async (req) => {
  // A body that is too large or not JSON is a failed attempt like any other: it is counted and logged, not waved through.
  const input = await readJson(req, 2_000).catch((e) => (e instanceof HttpError ? undefined : Promise.reject(e)));
  const s = await signIn(await getDb(), req, input);
  return json({ ok: true }, 200, { "set-cookie": sessionHeader(s.value, SESSION_TTL, req) });
});

/** Ends this browser's session on the server (it needs the cookie's own secret), and clears the cookie either way. */
export const DELETE = route(async (req) => {
  await signOut(await getDb(), req);
  return json({ ok: true }, 200, { "set-cookie": sessionHeader("", 0, req) });
});
