#!/usr/bin/env node
// Backup and restore drill on a THROWAWAY local PostgreSQL. It proves a pg_dump of a TEND database restores into something that is the same
// TEND: every table has the same rows, the audit hash chain verifies and ends at the same checkpoint, the append-only protection on the log still
// refuses changes, and enforcement state survives (a spent authorization is still spent, so restoring a backup cannot re-open an approval).
//
//   TEND_DRILL_DATABASE_URL=postgres://user@127.0.0.1:5432/postgres node --no-warnings scripts/backup-restore-drill.mjs
//
// It creates two databases with random names on that server and drops them at the end; nothing else is read or changed. It refuses any host
// that is not this machine. Needs pg_dump and pg_restore on PATH, of the server's major version.
// For a hosted database, follow docs/runbooks/backup-restore.md instead; this drill shows the procedure and the checks work.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { verifyAudit } from "../src/server/audit-chain.ts";
import { authAgent } from "../src/server/agent-auth.ts";
import { requestAuthorization, spendApproved } from "../src/server/authz.ts";
import { migrate, postgres } from "../src/server/db.ts";
import { decide, ingestEvents, registerAgent, setPolicy } from "../src/server/repo.ts";

const URL_ = process.env.TEND_DRILL_DATABASE_URL ?? "";
if (!URL_) { console.error("Set TEND_DRILL_DATABASE_URL to a throwaway local PostgreSQL (see the header of this file)."); process.exit(2); }
const host = new URL(URL_).hostname;
if (!["127.0.0.1", "localhost", "::1", "[::1]", ""].includes(host)) { console.error(`Refusing: the drill only runs against this machine, not ${host}.`); process.exit(2); }

let passed = 0, failed = 0;
const check = (ok, text) => { if (ok) passed++; else failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${text}`); };
const urlFor = (name) => { const u = new URL(URL_); u.pathname = `/${name}`; return u.toString(); };
const admin = new pg.Client({ connectionString: URL_ });
await admin.connect();
const src = `tend_drill_src_${randomBytes(4).toString("hex")}`, dst = `tend_drill_dst_${randomBytes(4).toString("hex")}`;
const dir = mkdtempSync(path.join(tmpdir(), "tend-drill-"));
const dump = path.join(dir, "tend.dump");

try {
  await admin.query(`CREATE DATABASE ${src}`);
  const db = await postgres(urlFor(src));
  await migrate(db);

  // Realistic state: two agents, a policy, a pending request, an approved-and-spent one, a denied one, reported tool calls.
  const reg = await registerAgent(db, { name: "Drill agent", model: "fake-model", provider: "Custom" });
  await registerAgent(db, { name: "Second agent", model: "fake-model", provider: "Custom" });
  await setPolicy(db, reg.agent.id, [{ tool: "send_report", action: "call", effect: "approve" }, { tool: "delete_records", action: "call", effect: "deny" }], "enforce");
  const agent = await authAgent(db, new Request("http://drill/api", { headers: { authorization: `Bearer ${reg.apiKey}` } }));
  const REQ = { tool: "send_report", action: "call", resource: "r-1" };
  const spent = (await requestAuthorization(db, agent, REQ, null)).view.id;
  await decide(db, spent, "approved");
  await spendApproved(db, agent, spent, REQ);
  const pending = (await requestAuthorization(db, agent, { ...REQ, resource: "r-2" }, null)).view.id;
  await requestAuthorization(db, agent, { tool: "delete_records", action: "call" }, null).catch(() => {});
  await ingestEvents(db, agent, [{ type: "tool.called", data: { tool: "send_report", action: "call", outcome: "success", authorizationId: spent } }]);
  const before = await verifyAudit(db);
  check(before.ok, `the source database's audit chain verifies (${before.checked} entries)`);
  const tables = (await db.all("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")).map((r) => r.tablename);
  const counts = async (d) => Object.fromEntries(await Promise.all(tables.map(async (t) => [t, Number((await d.get(`SELECT COUNT(*)::int AS n FROM "${t}"`)).n)])));
  const srcCounts = await counts(db);
  await db.close();

  // Back up and restore, as an operator would.
  execFileSync("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "--file", dump, urlFor(src)], { stdio: ["ignore", "ignore", "inherit"] });
  check(statSync(dump).size > 0, `pg_dump wrote a backup (${statSync(dump).size} bytes)`);
  await admin.query(`CREATE DATABASE ${dst}`);
  execFileSync("pg_restore", ["--no-owner", "--no-privileges", "--exit-on-error", "--dbname", urlFor(dst), dump], { stdio: ["ignore", "ignore", "inherit"] });

  const restored = await postgres(urlFor(dst));
  try {
    await migrate(restored); // a restored backup must be usable by the same code: no migration should be needed or fail
    const dstCounts = await counts(restored);
    const differ = tables.filter((t) => srcCounts[t] !== dstCounts[t]);
    check(differ.length === 0, `every table has the same number of rows after restore (${tables.length} tables${differ.length ? `; differ: ${differ.join(", ")}` : ""})`);
    const after = await verifyAudit(restored, 2_000, before.ok ? { firstSeq: before.firstChained ?? undefined, firstHash: before.firstHash ?? undefined, headSeq: before.headSeq ?? undefined, head: before.head ?? undefined } : undefined);
    check(after.ok && before.ok && after.head === before.head && after.headSeq === before.headSeq, "the restored audit chain verifies against the source's checkpoint (same head hash and sequence)");
    let refused = false;
    try { await restored.run("UPDATE events SET data = '{}' WHERE seq = (SELECT MIN(seq) FROM events)"); } catch { refused = true; }
    check(refused, "the restored log is still append-only: changing an entry is refused");
    const a2 = await authAgent(restored, new Request("http://drill/api", { headers: { authorization: `Bearer ${reg.apiKey}` } }));
    const replay = await spendApproved(restored, a2, spent, REQ).then(() => "ok", (e) => e.code);
    check(replay === "already_consumed", `a spent authorization is still spent after restore (spending it again: ${replay})`);
    const stillPending = (await restored.get("SELECT status FROM authorizations WHERE id = ?", pending))?.status;
    check(stillPending === "pending", "a request that was waiting is still waiting, not approved");
  } finally {
    await restored.close();
  }
} catch (e) {
  failed++;
  console.error("FAIL  the drill could not complete:", e.message);
} finally {
  for (const name of [src, dst]) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => {});
  await admin.end();
  rmSync(dir, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed || passed === 0 ? 1 : 0);
