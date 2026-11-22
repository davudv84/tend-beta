#!/usr/bin/env node
// Backup and recovery drill, on a LOCAL PostgreSQL only (DRILL_DATABASE_URL, a superuser URL on this machine; pg_dump and pg_restore on PATH).
// Builds a database with real TEND activity under tenant isolation and a signed context, keeps an audit checkpoint, dumps it, restores it into a
// new database, and checks: the audit chain still verifies against the checkpoint, tenant isolation still holds with the same context key, the
// application flows work on the copy, and tampering with the restored history is detected. Prints the time each step took. Removes what it made.
//   DRILL_DATABASE_URL=postgres://user@127.0.0.1:5432/postgres node --no-warnings scripts/ops/backup-restore-drill.mjs
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";

const BASE = process.env.DRILL_DATABASE_URL;
// Locally a missing URL is a skip; in CI it is a failure, so the drill can never pass by not running.
if (!BASE) { console.log("SKIP set DRILL_DATABASE_URL (a PostgreSQL superuser URL on this machine)"); process.exit(process.env.CI ? 1 : 0); }
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(BASE).hostname)) { console.error("refusing: DRILL_DATABASE_URL must point at this machine"); process.exit(2); }
process.env.TEND_CONTEXT_KEY = randomBytes(32).toString("base64url");
const { postgres, migrate, enableIsolation, allowEventRemoval } = await import("../../src/server/db.ts");
const { verifyAudit } = await import("../../src/server/audit-chain.ts");
const { withRequestContext, bindWorkspace, asSystem } = await import("../../src/server/db-context.ts");
const { registerAgent, setPolicy, decide, agentByKey, ingestEvents } = await import("../../src/server/repo.ts");
const { requestAuthorization, spendApproved } = await import("../../src/server/authz.ts");

let passed = 0, failed = 0;
const check = (ok, text) => { if (ok) passed++; else failed++; console.log(`${ok ? "ok  " : "FAIL"} ${text}`); };
const urlFor = (db) => { const u = new URL(BASE); u.pathname = `/${db}`; return u.toString(); };
const ms = (t0) => `${Math.round(performance.now() - t0)} ms`;
const admin = new pg.Client({ connectionString: BASE });
await admin.connect();
const src = `tend_drill_src_${randomBytes(4).toString("hex")}`, dst = `tend_drill_dst_${randomBytes(4).toString("hex")}`, role = `tend_drill_rt_${randomBytes(3).toString("hex")}`;
const work = mkdtempSync(path.join(tmpdir(), "tend-drill-"));
const asTenant = (ws, fn) => withRequestContext(async () => { bindWorkspace(ws); return fn(); });
const PAY = { tool: "wire", action: "send", resource: "ACC-1", detail: "EUR 5.00 to X" };
try {
  await admin.query(`CREATE DATABASE ${src}`);
  let db = await postgres(urlFor(src));
  await migrate(db);
  await db.run("INSERT INTO workspaces (id, name, created_at) VALUES ('wa', 'A', 0), ('wb', 'B', 0)");
  const A = await registerAgent(db, { name: "alpha", model: "m", provider: "Custom" }, "u", "wa");
  const B = await registerAgent(db, { name: "bravo", model: "m", provider: "Custom" }, "u", "wb");
  for (const x of [A, B]) await setPolicy(db, x.agent.id, [{ tool: "wire", action: "send", effect: "approve" }], "enforce");
  await enableIsolation(db, role);
  const spent = {};
  for (const [ws, key] of [["wa", A.apiKey], ["wb", B.apiKey]]) await asTenant(ws, async () => {
    const a = await agentByKey(db, key);
    const { view } = await requestAuthorization(db, a, PAY, null);
    await decide(db, view.id, "approved", undefined, "operator-1");
    await spendApproved(db, a, view.id, PAY);
    spent[ws] = view.id;
    await ingestEvents(db, a, Array.from({ length: 20 }, (_, i) => ({ type: "task.started", data: { taskId: `t${i}`, title: `${ws}-${i}` } })));
  });
  const cp = await asSystem(() => verifyAudit(db));
  check(cp.ok, `source log verifies (${cp.checked} chained events); checkpoint kept: #${cp.firstChained}..#${cp.headSeq}`);
  const checkpoint = { firstSeq: cp.firstChained, firstHash: cp.firstHash, head: cp.head, headSeq: cp.headSeq };
  // Every table's row count, to compare with the copy (read as the owner, past row-level security).
  const tables = (await db.all("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")).map((r) => r.tablename);
  // Counted over a plain connection as the drill's superuser: the application's runtime role is not allowed to read every table (the
  // context-key table is owner-only), which is the point of it.
  const counts = async (name) => {
    const c = new pg.Client({ connectionString: urlFor(name) });
    await c.connect();
    try { const out = {}; for (const t of tables) out[t] = Number((await c.query(`SELECT COUNT(*)::int AS n FROM "${t}"`)).rows[0].n); return out; } finally { await c.end(); }
  };
  const before = await counts(src);
  await db.close();

  let t0 = performance.now();
  const dump = path.join(work, "tend.dump");
  execFileSync("pg_dump", ["--format=custom", "--no-owner", "--file", dump, urlFor(src)], { stdio: "pipe" });
  check(statSync(dump).size > 0, `pg_dump (custom format): ${statSync(dump).size} bytes in ${ms(t0)}`);
  t0 = performance.now();
  await admin.query(`CREATE DATABASE ${dst}`);
  execFileSync("pg_restore", ["--no-owner", "--dbname", urlFor(dst), dump], { stdio: "pipe" });
  check(true, `pg_restore into a new database in ${ms(t0)}`);

  db = await postgres(urlFor(dst));
  const after = await counts(dst);
  const differ = tables.filter((t) => before[t] !== after[t]);
  check(differ.length === 0, `every table has the same number of rows on the copy (${tables.length} tables${differ.length ? `; differ: ${differ.join(", ")}` : ""})`);
  const restored = await asSystem(() => verifyAudit(db, 2_000, checkpoint));
  check(restored.ok, `restored log verifies AGAINST THE KEPT CHECKPOINT (${restored.ok ? restored.checked + " events" : restored.reason})`);
  await enableIsolation(db, role);
  check(db.isolation.on, "isolation starts on the restored copy with the same context key (the key table is part of the backup)");
  const seen = await asTenant("wa", () => db.all("SELECT DISTINCT agent_id FROM events"));
  check(seen.length === 1 && seen[0].agent_id === A.agent.id, "tenant A sees only its own history on the copy");
  await asTenant("wa", async () => {
    const a = await agentByKey(db, A.apiKey);
    // Restoring a backup must never re-open an approval: the one spent before the backup is still spent on the copy.
    const again = await spendApproved(db, a, spent.wa, PAY).then(() => "ok", (e) => e.code);
    check(again === "already_consumed", `a spent authorization is still spent on the copy (spending it again: ${again})`);
    const { view } = await requestAuthorization(db, a, { ...PAY, resource: "ACC-2" }, null);
    await decide(db, view.id, "approved");
    check((await spendApproved(db, a, view.id, { ...PAY, resource: "ACC-2" })).authorized === true, "agents' keys and the approval flow work on the restored copy");
  });
  // a restore from a tampered backup (someone with the owner role deletes the oldest events) is caught by the checkpoint, not by a bare walk
  const owner = await postgres(urlFor(dst));
  const edit = await owner.run("UPDATE events SET data = '{}' WHERE seq = (SELECT MIN(seq) FROM events)").then(() => "changed", () => "refused");
  check(edit === "refused", `the copy's log is still append-only: changing an entry, even as the owner, is ${edit}`);
  await owner.tx(async (q) => { await allowEventRemoval(q); await q.run("DELETE FROM events WHERE seq IN (SELECT seq FROM events ORDER BY seq LIMIT 3)"); });
  const bare = await asSystem(() => verifyAudit(owner));
  const pinned = await asSystem(() => verifyAudit(owner, 2_000, checkpoint));
  check(bare.ok === true && pinned.ok === false, `prefix deleted on the copy: a bare walk passes (${bare.ok}), the kept checkpoint catches it (${pinned.ok ? "missed" : pinned.reason})`);
  await owner.close(); await db.close();
} finally {
  for (const d of [src, dst]) await admin.query(`DROP DATABASE IF EXISTS ${d} WITH (FORCE)`).catch(() => {});
  await admin.query(`DROP ROLE IF EXISTS ${role}`).catch(() => {});
  await admin.end();
  rmSync(work, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
