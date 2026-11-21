#!/usr/bin/env node
// TEND_CONTEXT_KEY rotation drill, on a LOCAL PostgreSQL only (DRILL_DATABASE_URL, a superuser URL on this machine).
// Checks the procedure in docs/operations.md: a server started with a new key installs it next to the old one, both work during the rollout,
// and after the old key's row is removed a server still holding the old key sees no tenant rows (fails closed) while the new one keeps working.
// One process stands in for "old" and "new" servers by switching TEND_CONTEXT_KEY per request (the driver reads it per transaction).
//   DRILL_DATABASE_URL=postgres://user@127.0.0.1:5432/postgres node --no-warnings scripts/ops/context-key-rotation-drill.mjs
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";

const BASE = process.env.DRILL_DATABASE_URL;
if (!BASE) { console.log("SKIP set DRILL_DATABASE_URL (a PostgreSQL superuser URL on this machine)"); process.exit(0); }
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(BASE).hostname)) { console.error("refusing: DRILL_DATABASE_URL must point at this machine"); process.exit(2); }
const oldKey = randomBytes(32).toString("base64url"), newKey = randomBytes(32).toString("base64url");
process.env.TEND_CONTEXT_KEY = oldKey;
const D = await import("../../src/server/db.ts");
const { withRequestContext, bindWorkspace } = await import("../../src/server/db-context.ts");
const kid = (k) => createHash("sha256").update(Buffer.from(k, "utf8")).digest("hex").slice(0, 16);
let passed = 0, failed = 0;
const check = (ok, text) => { if (ok) passed++; else failed++; console.log(`${ok ? "ok  " : "FAIL"} ${text}`); };
const name = `tend_rot_${randomBytes(4).toString("hex")}`, role = `tend_rot_rt_${randomBytes(3).toString("hex")}`;
const url = new URL(BASE); url.pathname = `/${name}`;
const admin = new pg.Client({ connectionString: BASE });
await admin.connect();
const rows = (db, key) => withRequestContext(async () => { process.env.TEND_CONTEXT_KEY = key; bindWorkspace("wa"); return (await db.all("SELECT id FROM workspaces")).length; });
try {
  await admin.query(`CREATE DATABASE ${name}`);
  const oldServer = await D.postgres(url.toString());
  await D.migrate(oldServer);
  await oldServer.run("INSERT INTO workspaces (id, name, created_at) VALUES ('wa', 'A', 0), ('wb', 'B', 0)");
  await D.enableIsolation(oldServer, role);
  check(await rows(oldServer, oldKey) === 1, "server with the old key sees its tenant's row");
  process.env.TEND_CONTEXT_KEY = newKey;
  const newServer = await D.postgres(url.toString());
  await D.enableIsolation(newServer, role);
  const owner = await D.postgres(url.toString());
  const kids = (await owner.all("SELECT kid FROM tend_context_keys ORDER BY created_at")).map((r) => r.kid);
  check(kids.length === 2 && kids.includes(kid(oldKey)) && kids.includes(kid(newKey)), "starting a server with the new key installed it next to the old one");
  check(await rows(newServer, newKey) === 1 && await rows(oldServer, oldKey) === 1, "during the rollout both keys work");
  await owner.tx((q) => q.run("DELETE FROM tend_context_keys WHERE kid = ?", kid(oldKey)));
  check(await rows(newServer, newKey) === 1, "after the old key is removed the new key still works");
  check(await rows(oldServer, oldKey) === 0, "a server still holding the old key now sees nothing (fails closed)");
  check(await rows(newServer, "x".repeat(32)) === 0, "a key that was never installed sees nothing");
  await Promise.all([oldServer.close(), newServer.close(), owner.close()]);
} finally {
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => {});
  await admin.query(`DROP ROLE IF EXISTS ${role}`).catch(() => {});
  await admin.end();
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
