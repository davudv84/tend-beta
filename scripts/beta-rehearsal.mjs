#!/usr/bin/env node
// A local rehearsal of the three beta instances, before anything is deployed: a throwaway PostgreSQL cluster with three separate databases, and
// three production builds of TEND, each configured exactly like a hosted instance (production mode, DATABASE_URL, its own strong admin token, private, no demo,
// no local-only settings), checked from outside by scripts/beta-live-check.mjs, including the isolation matrix. Only TLS is missing (loopback http).
//
//   npm run build && npm run beta:rehearse
//
// Needs initdb and pg_ctl on PATH (brew install postgresql@17). Everything is created in a temp folder and removed at the end.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { check, newConfig } from "./beta-config.mjs";
import { liveCheck } from "./beta-live-check.mjs";
import { startIsolatedServer } from "./isolated-server.mjs";

const root = path.resolve(import.meta.dirname, "..");
const names = ["alice", "bob", "carol"];
const free = () => new Promise((res) => { const s = createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
for (const b of ["initdb", "pg_ctl"]) try { execFileSync("which", [b], { stdio: "ignore" }); } catch { console.error(`${b} not found. Install PostgreSQL (brew install postgresql@17).`); process.exit(2); }

const dir = mkdtempSync(path.join(tmpdir(), "tend-rehearsal-"));
const env = { ...process.env, LC_ALL: "C" };
const pgPort = await free();
const servers = [];
let failed = 0;
try {
  execFileSync("initdb", ["-D", `${dir}/data`, "-U", "tend_test", "--auth=trust", "-E", "UTF8", "--locale=C"], { env, stdio: "ignore" });
  execFileSync("pg_ctl", ["-D", `${dir}/data`, "-o", `-p ${pgPort} -h 127.0.0.1 -k ${dir}`, "-l", `${dir}/pg.log`, "-w", "start"], { env, stdio: "ignore" });
  const pg = (await import("pg")).default;
  const admin = new pg.Client({ connectionString: `postgres://tend_test@127.0.0.1:${pgPort}/postgres` });
  await admin.connect();
  for (const n of names) await admin.query(`CREATE DATABASE tend_${n}`);
  await admin.end();

  // The configuration a real beta would use, validated by the same rules (the database host is faked here only for that check).
  const configs = Object.fromEntries(names.map((n) => [n, { ...newConfig(), DATABASE_URL: `postgresql://owner:pw${n}x@ep-${n}-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require` }]));
  const verdict = check(configs).filter((r) => r.level === "fail");
  console.log(verdict.length ? `configuration problems:\n${verdict.map((v) => "  " + v.text).join("\n")}` : "beta configuration rules: 3 instances pass (separate tokens, databases, private, no demo, no local-only settings)");
  if (verdict.length) failed++;

  const sandbox = mkdtempSync(path.join(tmpdir(), "tend-rehearsal-sb-"));
  for (const n of names) {
    const c = configs[n];
    servers.push({ name: n, token: c.TEND_ADMIN_TOKEN, server: await startIsolatedServer({ root, database: "postgres", env: { TEND_ADMIN_TOKEN: c.TEND_ADMIN_TOKEN, TEND_GATEWAY_PAYMENTS_KEY: c.TEND_GATEWAY_PAYMENTS_KEY, TEND_GATEWAY_SANDBOX_DIR: sandbox, DATABASE_URL: `postgres://tend_test@127.0.0.1:${pgPort}/tend_${n}`, TEND_LOCAL_HTTP: "", TEND_PUBLIC: c.TEND_PUBLIC, TEND_DEMO: c.TEND_DEMO } }) });
  }
  const results = await liveCheck({ allowHttp: true, instances: servers.map((s) => ({ name: s.name, url: s.server.url, token: s.token })) });
  for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"} [${r.instance}] ${r.text}`);
  failed += results.filter((r) => !r.ok).length;
  console.log(`\nrehearsal: ${results.length - results.filter((r) => !r.ok).length} passed, ${failed} failed (3 isolated production-configured instances on 3 PostgreSQL databases)`);
} catch (e) {
  console.error(`rehearsal error: ${e.message}`);
  failed++;
} finally {
  for (const s of servers) await s.server.stop();
  try { execFileSync("pg_ctl", ["-D", `${dir}/data`, "-m", "immediate", "stop"], { env, stdio: "ignore" }); } catch {}
  rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
