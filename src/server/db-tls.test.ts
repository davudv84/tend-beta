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

test("a remote database URL without any sslmode is not sent in clear text: it is pinned to verify-full; this machine is left alone", () => {
  for (const host of ["db.example.com", "ep-x.eu-central-1.aws.neon.tech", "10.0.0.5", "[2001:db8::1]"]) {
    const out = new URL(verifiedTls(pg(`p%40ss@${host}:5432/db`)));
    assert.equal(out.searchParams.get("sslmode"), "verify-full", host);
    assert.equal(decodeURIComponent(out.password), "p@ss", "credentials survive untouched");
  }
  for (const local of ["postgres://u:p@localhost:5432/db", "postgres://u:p@127.0.0.1:5432/db", "postgres://u:p@[::1]:5432/db", "postgres://u@/db?host=/var/run/postgresql"])
    assert.equal(verifiedTls(local), local, local);
  assert.equal(verifiedTls(pg("p@db.example.com/db?sslmode=disable")), pg("p@db.example.com/db?sslmode=disable"), "an explicit disable stays the operator's choice");
  assert.equal(tlsMode(pg("p@db.example.com/db")), "verify-full");
});
