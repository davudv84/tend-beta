// The database start-up path fails closed: no usable database means no application, never a silent fallback to another store.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { assertSchemaCurrent, getDb, memoryDb, MIGRATIONS } from "./db.ts";

const g = globalThis as { __tendDb?: Promise<unknown> };
async function withEnv(env: Record<string, string | undefined>, fn: () => Promise<void>) {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  g.__tendDb = undefined;
  try { await fn(); } finally { for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v); g.__tendDb = undefined; }
}
const rejects = async (p: Promise<unknown>) => { try { await p; return undefined; } catch (e) { return e as Error & { code?: string }; } };

test("an unreachable DATABASE_URL stops the start, is not cached as a success, and never falls back to the embedded database", async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "tend-startup-"));
  await withEnv({ DATABASE_URL: "postgres://nobody@127.0.0.1:1/none?sslmode=disable", POSTGRES_URL: undefined, DATABASE_MIGRATE_URL: undefined, TEND_DATA_DIR: dataDir, VERCEL: undefined }, async () => {
    const first = await rejects(getDb());
    assert.ok(first, "getDb rejects");
    assert.match(first!.message + String((first as { code?: string }).code ?? ""), /ECONNREFUSED|connect|AggregateError/i, "because the database could not be reached, not for some unrelated reason");
    const second = await rejects(getDb());
    assert.ok(second, "and rejects again: a failed start is retried, not remembered as a database");
    assert.equal(existsSync(path.join(dataDir, "pglite")), false, "no embedded database was created in its place");
  });
});

test("on Vercel, with no database configured, the start is refused (503), not served from a throwaway store", async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "tend-startup-"));
  await withEnv({ DATABASE_URL: undefined, POSTGRES_URL: undefined, DATABASE_MIGRATE_URL: undefined, VERCEL: "1", TEND_DATA_DIR: dataDir }, async () => {
    const e = await rejects(getDb());
    assert.equal((e as { code?: string } | undefined)?.code, "database_not_configured");
    assert.equal(existsSync(path.join(dataDir, "pglite")), false);
  });
});

test("DATABASE_MIGRATE_URL without DATABASE_URL is refused", async () => {
  await withEnv({ DATABASE_URL: undefined, POSTGRES_URL: undefined, DATABASE_MIGRATE_URL: "postgres://x@127.0.0.1:1/x", VERCEL: undefined, TEND_DATA_DIR: mkdtempSync(path.join(tmpdir(), "tend-startup-")) }, async () => {
    const e = await rejects(getDb());
    assert.match(String(e?.message), /DATABASE_MIGRATE_URL is set without DATABASE_URL/);
  });
});

test("a schema that is missing a migration is not accepted by the application role", async () => {
  const db = await memoryDb();
  await assertSchemaCurrent(db); // current: fine
  await db.run("DELETE FROM schema_migrations WHERE version = ?", MIGRATIONS.length);
  const e = await rejects(assertSchemaCurrent(db));
  assert.match(String(e?.message), new RegExp(`missing migrations ${MIGRATIONS.length}\\b`));
  await db.close();
});
