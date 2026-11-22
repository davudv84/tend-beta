import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeSecret, hotp, STEP_MS, verifyTotp } from "./totp.ts";

// RFC 6238 appendix B, SHA-1: the ASCII secret "12345678901234567890". Its base32 form is what an authenticator app is given.
const RFC = Buffer.from("12345678901234567890");
const RFC_B32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

test("RFC 6238 test vectors (8 digits), and the six-digit codes apps show", () => {
  for (const [t, code] of [[59, "94287082"], [1111111109, "07081804"], [1111111111, "14050471"], [1234567890, "89005924"], [2000000000, "69279037"], [20000000000, "65353130"]] as const)
    assert.equal(hotp(RFC, Math.floor(t / 30), 8), code, `T=${t}`);
  assert.equal(hotp(RFC, Math.floor(59 / 30)), "287082");
  assert.deepEqual(decodeSecret(RFC_B32), RFC);
  assert.deepEqual(decodeSecret(RFC_B32.toLowerCase().replace(/(.{4})/g, "$1 ")), RFC, "lower case and spaces, as apps display it");
});

test("a secret must be base32 and at least 128 bits", () => {
  assert.equal(decodeSecret(""), null);
  assert.equal(decodeSecret("JBSWY3DPEHPK3PXP"), null, "80 bits is too short");
  assert.equal(decodeSecret("not base32 at all!"), null);
  assert.equal(decodeSecret("0189ABCDEFGHIJKLMNOPQRSTUVWXYZAB"), null, "0, 1, 8 and 9 are not base32");
});

test("a code is accepted in its own step and one either side, never further, and only as six digits", () => {
  const now = 1_700_000_000_000, step = Math.floor(now / STEP_MS);
  for (const d of [-1, 0, 1]) assert.equal(verifyTotp(RFC, hotp(RFC, step + d), now), step + d);
  for (const d of [-2, 2, 10]) assert.equal(verifyTotp(RFC, hotp(RFC, step + d), now), null);
  for (const bad of [undefined, null, 123456, "", "12345", "1234567", "12345a", " 123456"]) assert.equal(verifyTotp(RFC, bad, now), null);
});
