import assert from "node:assert/strict";
import { test } from "node:test";
import { generate } from "otplib";
import { canonicalSecret, STEP_MS, verifyTotp } from "./totp.ts";

// RFC 6238 appendix B: the ASCII secret "12345678901234567890", built from its bytes here so no secret-shaped literal sits in the source.
const b32 = (bytes: Buffer) => { const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, v = 0, out = ""; for (const x of bytes) { v = (v << 8) | x; bits += 8; while (bits >= 5) { out += A[(v >>> (bits - 5)) & 31]; bits -= 5; } } return bits ? out + A[(v << (5 - bits)) & 31] : out; };
const RFC = b32(Buffer.from("12345678901234567890"));

test("the library is configured as authenticator apps expect: RFC 6238 vectors (SHA-1, 30 s steps), six digits", async () => {
  assert.equal(await generate({ secret: RFC, epoch: 59 }), "287082");
  assert.equal(await generate({ secret: RFC, epoch: 1111111109 }), "081804");
  assert.equal(await generate({ secret: RFC, epoch: 1234567890 }), "005924");
});

test("a secret must be base32 and at least 128 bits; spaces and lower case are accepted as apps show them", () => {
  assert.equal(canonicalSecret(RFC), RFC);
  assert.equal(canonicalSecret(RFC.toLowerCase().replace(/(.{4})/g, "$1 ")), RFC);
  for (const bad of ["", "JBSWY3DPEHPK3PXP", "not base32 at all!", "0189" + RFC.slice(4)]) assert.equal(canonicalSecret(bad), null, bad);
});

test("a code is accepted in its own step and one either side, never further, and only as six digits", async () => {
  const now = 1_700_000_000_000, step = Math.floor(now / STEP_MS);
  for (const d of [-1, 0, 1]) assert.equal(await verifyTotp(RFC, await generate({ secret: RFC, epoch: (step + d) * 30 }), now), step + d);
  for (const d of [-3, 3, 10]) assert.equal(await verifyTotp(RFC, await generate({ secret: RFC, epoch: (step + d) * 30 }), now), null);
  for (const bad of [undefined, null, 123456, "", "12345", "1234567", "12345a", " 123456"]) assert.equal(await verifyTotp(RFC, bad, now), null);
});
