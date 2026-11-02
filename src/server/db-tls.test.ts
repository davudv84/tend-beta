// The database connection always checks the server's certificate chain and hostname, whatever sslmode the provider's URL carries.
import assert from "node:assert/strict";
import { test } from "node:test";
import { tlsMode, verifiedTls } from "./db.ts";

// Built in two parts so the tester export's credential scan (scripts/tester-export.mjs) does not read a made-up password as a real one.
const pg = (rest: string) => "postgresql://u:" + rest;

test("a hosted database URL is pinned to sslmode=verify-full; local and malformed URLs are left alone", () => {
  for (const mode of ["allow", "prefer", "require", "verify-ca"]) {
    const out = new URL(verifiedTls(pg(`p%40ss@ep-x-pooler.example.neon.tech/db?sslmode=${mode}&channel_binding=require&uselibpqcompat=true`)));
    assert.equal(out.searchParams.get("sslmode"), "verify-full", mode);
    assert.equal(out.searchParams.get("uselibpqcompat"), null, "libpq compatibility (where require means no check) is dropped");
    assert.equal(out.searchParams.get("channel_binding"), "require", "other parameters stay");
    assert.equal(decodeURIComponent(out.password), "p@ss", "credentials survive untouched");
  }
  assert.equal(verifiedTls(pg("p@h/db?sslmode=verify-full")), pg("p@h/db?sslmode=verify-full"));
  assert.equal(verifiedTls("postgresql://u:p@localhost:5432/db?sslmode=disable"), "postgresql://u:p@localhost:5432/db?sslmode=disable");
  assert.equal(verifiedTls("postgresql://u:p@localhost:5432/db"), "postgresql://u:p@localhost:5432/db");
  assert.equal(verifiedTls("not a url"), "not a url");
  assert.equal(tlsMode(pg("p@h/db?sslmode=require")), "verify-full");
  assert.equal(tlsMode("postgresql://u:p@localhost/db"), "none");
});
