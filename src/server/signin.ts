// Signing in with the admin token. The rules, in one place so they can be tested without a server:
//  - A wrong token is a failure, counted per caller (a trusted address, see clientIp). Ten failures a minute and that caller is
//    refused until the minute ends. Nobody else is affected, so nobody can lock the operator out.
//  - Where no address can be trusted (everyone is "unknown") there is nobody to hold responsible, so nobody is refused: the
//    correct token always works, and wrong ones are slowed down in proportion to how many there have been. The token's own
//    length and randomness are what protect it in that setup; see the README.
//  - Every outcome is written to the authentication log (session.ts) without the token. A success and its session are written together.
import type { DB } from "./db.ts";
import { checkAdminToken } from "./auth.ts";
import { config } from "./config.ts";
import { clientIp, HttpError } from "./http.ts";
import { audit, createSession, signOut } from "./session.ts";
import { spend } from "./limits.ts";

export const FAILURES_PER_MINUTE = 10;
export const SIGNINS_PER_MINUTE = 30;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The log must never turn a refusal into a different answer, but it must not fail silently either. */
const note = (db: DB, ...a: Parameters<typeof audit> extends [unknown, ...infer R] ? R : never) =>
  audit(db, ...a).catch((e) => console.error("[tend] could not write to the authentication log", (e as Error).message));

export async function signIn(db: DB, req: Request, input: unknown, now = Date.now(), wait: (ms: number) => Promise<unknown> = sleep) {
  const client = clientIp(req);
  const known = client !== "unknown";
  if (config.adminDisabled) throw new HttpError(404, "not_found", "Not found.");
  if (!config.adminToken) {
    await note(db, "signin.failed", { client, reason: "operator_disabled", now });
    throw new HttpError(403, "operator_disabled", config.adminTokenWeak ? "The server’s TEND_ADMIN_TOKEN is too weak, so operator sign-in is disabled. It needs at least 32 random characters." : "Operator access isn’t configured. Set TEND_ADMIN_TOKEN on the server.");
  }
  // Taken as a failure first, atomically, and given back on success: of any number of parallel attempts, only ten are ever evaluated.
  const attempt = await spend(db, `signin:fail:${client}`, FAILURES_PER_MINUTE, { now });
  if (known && !attempt.ok) {
    if (attempt.n === FAILURES_PER_MINUTE + 1) await note(db, "signin.blocked", { client, reason: "too_many_failures", now });
    throw new HttpError(429, "rate_limited", "Too many failed sign-in attempts from this address. Try again shortly.", { retryAfter: attempt.retryAfter });
  }
  const token = (input as { token?: unknown } | null | undefined)?.token;
  if (typeof token !== "string" || !checkAdminToken(token)) {
    await note(db, "signin.failed", { client, reason: typeof token === "string" ? "invalid_token" : "malformed", now });
    if (!known) await wait(Math.min(2_000, Math.max(0, attempt.n - FAILURES_PER_MINUTE) * 100));
    throw new HttpError(401, "invalid_token", "That admin token isn’t valid.");
  }
  await spend(db, `signin:fail:${client}`, FAILURES_PER_MINUTE, { now, cost: -1 });
  if (!(await spend(db, `signin:ok:${client}`, SIGNINS_PER_MINUTE, { now })).ok)
    throw new HttpError(429, "rate_limited", "Too many sign-ins. Try again shortly.", { retryAfter: 60 });
  await signOut(db, req, now); // a sign-in replaces the session this browser already held
  return db.tx(async (q) => {
    const s = await createSession(q, { now, client });
    await audit(q, "signin.succeeded", { sessionId: s.id, client, now });
    return s;
  });
}
