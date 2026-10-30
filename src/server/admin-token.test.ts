// A production build refuses a weak admin token (sign-in is disabled, fail closed); development keeps the 24-character floor.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { adminTokenProblem, config } from "./config.ts";
import { memoryDb } from "./db.ts";
import { signIn } from "./signin.ts";

const good = randomBytes(32).toString("base64url");

test("production: random 32+ character tokens pass; short, repetitive and low-variety ones do not", () => {
  assert.equal(adminTokenProblem(good, true), undefined);
  // Fixed, not random: a random 48-character hex string has fewer than 14 distinct characters often enough to make this test flaky.
  const hex = Array.from({ length: 48 }, (_, i) => "0123456789abcdef"[(i * 7) % 16]).join("");
  assert.equal(adminTokenProblem(hex, true), undefined, "48 hex characters: 16 distinct, long enough");
  for (const weak of ["a".repeat(40), "abcabcabcabcabcabcabcabcabcabcabc", "password1234password1234password1234", "0123456789012345678901234567890123", "x".repeat(31) + "y", "tend-admin-tend-admin-tend-admin-tend-admin"])
    assert.ok(adminTokenProblem(weak, true), weak);
  assert.match(adminTokenProblem("short-but-24-chars-long-xyz!", true)!, /32/);
  assert.match(adminTokenProblem("tooshort", true)!, /24/);
});

test("development keeps the 24-character floor, so local setups are unchanged", () => {
  assert.equal(adminTokenProblem("test-admin-token-0123456789", false), undefined);
  assert.equal(adminTokenProblem("a".repeat(24), false), undefined);
  assert.ok(adminTokenProblem("a".repeat(23), false));
});

test("a weak token in a production server disables sign-in and says why, without revealing anything about the token", async () => {
  const before = { env: process.env.NODE_ENV, tok: process.env.TEND_ADMIN_TOKEN };
  const db = await memoryDb();
  const req = new Request("http://tend.test/api/operator/session", { method: "POST" });
  try {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.TEND_ADMIN_TOKEN = "a".repeat(40);
    assert.equal(config.adminToken, "");
    assert.equal(config.adminTokenWeak, true);
    await assert.rejects(signIn(db, req, { token: "a".repeat(40) }), (e: { status?: number; code?: string; message?: string }) => e.status === 403 && e.code === "operator_disabled" && /too weak/.test(e.message ?? "") && !e.message!.includes("aaaa"));

    process.env.TEND_ADMIN_TOKEN = good;
    assert.equal(config.adminToken, good);
    assert.equal(config.adminTokenWeak, false);
    assert.ok((await signIn(db, req, { token: good })).value, "a strong token signs in");

    delete process.env.TEND_ADMIN_TOKEN;
    assert.equal(config.adminTokenWeak, false);
    await assert.rejects(signIn(db, req, { token: good }), (e: { message?: string }) => /isn’t configured/.test(e.message ?? ""));
  } finally {
    if (before.env === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV; else (process.env as Record<string, string>).NODE_ENV = before.env;
    if (before.tok === undefined) delete process.env.TEND_ADMIN_TOKEN; else process.env.TEND_ADMIN_TOKEN = before.tok;
    await db.close();
  }
});
