// Why the API-key hash is SHA-256 and not a password hash, and what keeps it that way (CodeQL js/insufficient-password-hash, src/server/auth.ts).
//
// A slow, salted password hash (scrypt here) exists to make GUESSING a low-entropy secret expensive after a database leak. TEND's agent keys,
// approval tokens and invitation/account-link tokens are not chosen by people: the server draws them from the CSPRNG (192 to 256 bits), so there
// is nothing to guess and a fast hash is the standard choice; it is also what lets a request find its agent by hash in one indexed lookup.
// Passwords are the only human-chosen secrets and they go through scrypt with a random salt. These tests fail if that ever stops being true:
// a key that is no longer random, a new caller that feeds something else into the fast hash, or a change that would break every stored key.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { checkPassword, hashPassword } from "./accounts.ts";
import { bearer, hashKey, KEY_PREFIX, newKey } from "./auth.ts";

test("HASH-1 agent keys are server-generated 192-bit random tokens: fixed format, never repeated, never chosen by a person", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const k = newKey();
    assert.match(k.key, /^tend_sk_[A-Za-z0-9_-]{32}$/, "prefix + 32 base64url characters = 24 random bytes = 192 bits");
    assert.equal(k.hash, hashKey(k.key));
    assert.equal(k.prefix, k.key.slice(0, KEY_PREFIX.length + 6), "the shown prefix is 6 characters (36 bits) of the key, not enough to search the rest");
    assert.ok(!seen.has(k.key));
    seen.add(k.key);
  }
});

test("HASH-2 the stored-key hash is unchanged (SHA-256 hex): every key issued so far keeps working", () => {
  assert.equal(hashKey(`tend_sk_${"A".repeat(32)}`), "0493c63ab1963ab460c191f59ae5ff7cc222eb9964276b5295c158e39babda69");
});

test("HASH-3 only the generated key and token formats are accepted as bearer credentials, so a human password never reaches the key lookup", () => {
  const req = (v: string) => new Request("http://t/", { headers: { authorization: v } });
  const k = newKey().key;
  assert.equal(bearer(req(`Bearer ${k}`)), k);
  for (const bad of ["Bearer correct horse battery staple", "Bearer hunter2", "Bearer tend_sk_short", `Bearer ${k}!`, `Basic ${k}`]) assert.equal(bearer(req(bad)), undefined, bad);
});

test("HASH-4 the fast hash is applied only to server-generated tokens: every reference to hashKey anywhere in src is a reviewed one", () => {
  // Every mention of the identifier counts, imports included, so an alias (import { hashKey as h }) cannot hide a new use. A new use (for
  // example a password, a user-chosen PIN or an imported key) must be reviewed and added here on purpose.
  const root = path.join(import.meta.dirname, "..");
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const refs = walk(root).filter((f) => /\.(ts|tsx|mjs|js)$/.test(f) && !/\.test\.(ts|mjs)$/.test(f))
    .flatMap((f) => readFileSync(f, "utf8").split("\n").filter((line) => /\bhashKey\b/.test(line)).map((line) => `${path.relative(root, f)}: ${line.trim().slice(0, 70)}`));
  const reviewed = [
    "server/auth.ts: return { key, hash: hashKey(key), prefix", // newKey(): 192 random bits
    "server/auth.ts: export const hashKey = ", //                   the definition
    "server/repo.ts: import { hashKey, newKey }", //
    "server/repo.ts: const hash = hashKey(key);", //               agentByKey: lookup of a presented key
    "server/authz.ts: import { hashKey }", //
    "server/authz.ts: const n = await q.run(\"UPDATE authorizations SET token_hash", // token claim: newToken(), 256 random bits
    "server/authz.ts: const th = hashKey(token)", //               token spend: lookup of a presented token
  ];
  assert.equal(refs.length, reviewed.length, `hashKey references changed:\n${refs.join("\n")}`);
  for (const r of reviewed) assert.ok(refs.some((x) => x.startsWith(r)), `missing or changed: ${r}\nall: ${refs.join(" | ")}`);
  const authz = readFileSync(path.join(root, "server", "authz.ts"), "utf8");
  assert.match(authz, /const newToken = \(\) => `tend_az_\$\{randomBytes\(32\)\.toString\("base64url"\)\}`/, "approval tokens are 256 random bits");
});

test("HASH-5 passwords, the only human-chosen secrets, use scrypt with a random salt (slow, salted), never the token hash", async () => {
  const a = await hashPassword("correct horse battery staple"), b = await hashPassword("correct horse battery staple");
  assert.match(a, /^scrypt\$15\$8\$1\$/);
  assert.notEqual(a, b, "salted: the same password never gives the same hash");
  assert.ok(!a.includes(hashKey("correct horse battery staple")));
  assert.equal(await checkPassword("correct horse battery staple", a), true);
  assert.equal(await checkPassword("wrong horse battery staple", a), false);
});
