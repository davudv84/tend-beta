// Helpers for tests that need an operator session. Not a test file: it only builds real sessions in a test database.
import type { Q } from "./db.ts";
import { createSession, sessionCookieName } from "./session.ts";

export async function signedIn(db: Q, opts: { now?: number; client?: string } = {}) {
  const s = await createSession(db, opts);
  const cookie = `${sessionCookieName()}=${s.value}`;
  return {
    id: s.id, value: s.value, cookie,
    /** A request as this browser would send it. */
    request: (headers: Record<string, string> = {}, url = "http://tend.test/api/v1/x") => new Request(url, { method: "POST", headers: { host: "tend.test", cookie, ...headers } }),
  };
}

/** Rate-limit windows are calendar minutes. A test that counts across one must not straddle two of them: wait out the end of a minute that is about to roll over. */
export async function awayFromMinuteBoundary(needMs = 8_000) {
  const left = 60_000 - (Date.now() % 60_000);
  if (left < needMs) await new Promise((r) => setTimeout(r, left + 100));
}
