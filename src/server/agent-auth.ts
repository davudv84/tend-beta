import { bearer } from "./auth.ts";
import type { DB } from "./db.ts";
import { clientIp, HttpError, limit } from "./http.ts";
import { agentByKey } from "./repo.ts";
import { audit } from "./session.ts";
import { spend } from "./limits.ts";

/** Rejected keys one caller may present per minute. Only failures count: a valid key never touches this budget, so nobody can use it to lock an agent out. */
export const KEY_FAILURES_PER_MINUTE = 20;

/**
 * A request that did not present a usable key. It is counted against the caller's address (past the budget the answer is 429, with the
 * same 401 body otherwise) and, if a key was actually presented, written to the authentication log without the key (R-07).
 */
async function rejected(db: DB, req: Request, code: "missing_key" | "invalid_key", message: string): Promise<never> {
  const client = clientIp(req);
  const attempt = await spend(db, `keyfail:${client}`, KEY_FAILURES_PER_MINUTE);
  if (client !== "unknown" && !attempt.ok) throw new HttpError(429, "rate_limited", "Too many rejected agent keys from this address. Try again shortly.", { retryAfter: attempt.retryAfter });
  if (req.headers.get("authorization")) await audit(db, "agentkey.rejected", { client, reason: code }).catch((e) => console.error("[tend] could not write to the authentication log", (e as Error).message));
  throw new HttpError(401, code, message);
}

/** Resolves the calling agent from its API key, with a per-agent rate limit. */
export async function authAgent(db: DB, req: Request) {
  const key = bearer(req);
  if (!key) return rejected(db, req, "missing_key", "Send your agent key as: Authorization: Bearer tend_sk_…");
  const agent = await agentByKey(db, key);
  if (!agent) return rejected(db, req, "invalid_key", "Unknown or revoked API key.");
  await limit(db, `agent:${agent.id}`, 120);
  return agent;
}
