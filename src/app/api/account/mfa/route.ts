import { checkPassword } from "@/server/accounts";
import { getDb } from "@/server/db";
import { HttpError, json, readJson, requireOperator, route } from "@/server/http";
import { spend } from "@/server/limits";
import { confirmEnrollment, disableMfa, mfaStatus, startEnrollment } from "@/server/mfa";

/** Whether the signed-in account has two-step sign-in, and how many recovery codes are left. */
export const GET = route(async (req) => {
  const db = await getDb();
  const s = await requireOperator(req, db, "self");
  if (!s.userId) return json({ enabled: false, available: false });
  return json({ ...(await mfaStatus(db, s.userId)), available: true });
});

/**
 * { action: "setup" }                          a new secret and its otpauth:// link for the authenticator app (not required yet)
 * { action: "enable", code }                   turns it on with the app's current code; returns recovery codes once; other sessions end
 * { action: "disable", password, code }        turns it off: the password and a current code or a recovery code
 */
export const POST = route(async (req) => {
  const db = await getDb();
  const s = await requireOperator(req, db, "self");
  const o = ((await readJson(req, 1_000)) ?? {}) as { action?: unknown; code?: unknown; password?: unknown };
  if (!s.userId) throw new HttpError(400, "not_an_account", "The admin token cannot use two-step sign-in.");
  // Wrong codes and passwords here are guesses like any other: 10 per account per hour.
  if (o.action !== "setup" && !(await spend(db, `mfa:attempt:${s.userId}`, 10, { windowMs: 3_600_000 })).ok)
    throw new HttpError(429, "rate_limited", "Too many attempts. Try again later.", { retryAfter: 3600 });
  if (o.action === "setup") return json(await db.tx((q) => startEnrollment(q, s)));
  if (o.action === "enable") return json(await db.tx((q) => confirmEnrollment(q, s, o.code)));
  if (o.action === "disable") {
    const u = await db.get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", s.userId);
    if (!u || typeof o.password !== "string" || !(await checkPassword(o.password, u.password_hash))) throw new HttpError(401, "invalid_credentials", "That password is not right.");
    return json(await db.tx((q) => disableMfa(q, s, o.code)));
  }
  throw new HttpError(422, "invalid_action", "action must be setup, enable or disable.");
});
