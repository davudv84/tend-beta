// Time-based one-time codes (RFC 6238, the six digits an authenticator app shows), for the admin's optional second factor. SHA-1, 30-second
// steps, as every authenticator app expects. No dependency: the algorithm is a dozen lines and the RFC's own test vectors are in totp.test.ts.
import { createHmac, timingSafeEqual } from "node:crypto";

export const STEP_MS = 30_000;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** A base32 secret (spaces and lower case allowed, padding optional) as bytes; null if it is not valid base32 or shorter than 128 bits. */
export function decodeSecret(text: string): Buffer | null {
  const s = text.replace(/[\s=]/g, "").toUpperCase();
  if (!s || /[^A-Z2-7]/.test(s)) return null;
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of s) {
    value = (value << 5) | ALPHABET.indexOf(c);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return out.length >= 16 ? Buffer.from(out) : null; // RFC 4226 asks for at least 128 bits
}

/** The code for one counter value (RFC 4226 HOTP with dynamic truncation). */
export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", secret).update(msg).digest();
  const o = h[h.length - 1] & 0x0f;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, "0");
}

/**
 * The time step a code belongs to, or null. One step either side is accepted for clock drift, and every candidate is compared in constant
 * time, so how long this takes says nothing about which step (if any) matched.
 */
export function verifyTotp(secret: Buffer, code: unknown, now = Date.now()): number | null {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return null;
  const step = Math.floor(now / STEP_MS);
  let found: number | null = null;
  for (const s of [step - 1, step, step + 1]) if (timingSafeEqual(Buffer.from(hotp(secret, s)), Buffer.from(code)) && found === null) found = s;
  return found;
}
