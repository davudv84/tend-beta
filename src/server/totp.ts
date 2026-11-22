// The admin's optional second factor (TEND_ADMIN_TOTP_SECRET): time-based one-time codes, RFC 6238, the six digits an authenticator app shows.
// The algorithm is otplib's, the same maintained library accounts use (mfa.ts); nothing here implements it. What this module adds: a strict
// check of the configured secret (base32, at least 128 bits), so a mistyped value disables admin sign-in instead of weakening it, and a
// verifier that reports which 30-second step a code belongs to, so signin.ts can spend each step once.
import { verify } from "otplib";

export const STEP_MS = 30_000;
/** ±1 step (30 s) for a slightly wrong clock, as for accounts (mfa.ts). */
const TOLERANCE_S = 30;

/** The secret in canonical base32 (upper case, no spaces or padding), or null if it is not valid base32 of at least 128 bits. */
export function canonicalSecret(text: string): string | null {
  const s = text.replace(/[\s=]/g, "").toUpperCase();
  if (!s || /[^A-Z2-7]/.test(s)) return null;
  return Math.floor((s.length * 5) / 8) >= 16 ? s : null; // RFC 4226 asks for at least 128 bits
}

/** The time step a code belongs to, or null. Six digits only; anything else is refused before the library sees it. */
export async function verifyTotp(secret: string, code: unknown, now = Date.now()): Promise<number | null> {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return null;
  const r = await verify({ secret, token: code, epoch: Math.floor(now / 1000), epochTolerance: TOLERANCE_S });
  return r.valid && "timeStep" in r && typeof r.timeStep === "number" ? r.timeStep : null;
}
