#!/usr/bin/env node
// Read-only checks of the six Preview variables and the Neon rehearsal branch. Prints names, host ids and PASS/FAIL only; never a value.
// Run from the root of the tend-beta checkout:  node preview-checks.mjs .env.preflight --main-host ep-xxxxxx
//   --main-host: the endpoint id of the PRODUCTION branch (Neon > Branches > main > Connect; the "ep-…" part of the host). REQUIRED:
//   without it the isolation check FAILS.
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
const root = process.cwd(), require = createRequire(root + "/package.json");
const file = process.argv[2], mi = process.argv.indexOf("--main-host"), mainHost = mi > 0 ? process.argv[mi + 1] : "";
if (!file) { console.error("usage: node preview-checks.mjs .env.preflight --main-host ep-xxxx"); process.exit(2); }
// Safety: refuse to read a credentials file that Git could commit, or that other users on this computer can read.
try { execFileSync("git", ["check-ignore", "-q", file], { cwd: root, stdio: "ignore" }); } catch { console.error("REFUSED: " + file + " is not ignored by Git (or this is not a Git checkout). Use the name .env.preflight."); process.exit(2); }
if (process.platform !== "win32" && (statSync(file).mode & 0o077) !== 0) { console.error("REFUSED: " + file + " is readable by other users. Run: chmod 600 " + file); process.exit(2); }
const env = {};
for (const l of readFileSync(file, "utf8").split("\n")) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1").trim(); }
let bad = 0;
const ok = (c, msg) => { console.log((c ? "PASS  " : "FAIL  ") + msg); if (!c) bad++; };
const SIX = ["DATABASE_URL", "DATABASE_MIGRATE_URL", "TEND_CONTEXT_KEY", "TEND_MFA_KEY", "TEND_ADMIN_TOKEN", "TEND_APP_URL"];

console.log("\n1. Variable names");
for (const n of SIX) ok(!!env[n], `${n} is set`);
const extra = Object.keys(env).filter((n) => !SIX.includes(n));
console.log(extra.length ? `INFO  other names in this file: ${extra.join(", ")}` : "INFO  no other names in this file");

console.log("\n2. TEND's own production preflight");
const { checkProductionConfig } = await import(pathToFileURL(root + "/scripts/check-production-config.mjs").href);
const r = checkProductionConfig(env);
const probs = r.problems ?? r.blocking ?? [], warns = r.warnings ?? [];
for (const p of probs) ok(false, p);
for (const w of warns) console.log("WARN  " + w);
ok(probs.length === 0, "no blocking problems");

console.log("\n3. Which Neon endpoint each URL points at");
const parse = (v) => { try { const u = new URL(v); return { host: u.hostname, user: decodeURIComponent(u.username), db: u.pathname.slice(1), ssl: u.searchParams.get("sslmode") }; } catch { return null; } };
const a = parse(env.DATABASE_URL ?? ""), b = parse(env.DATABASE_MIGRATE_URL ?? "");
const ep = (h) => (h?.match(/^(ep-[a-z0-9-]+?)(-pooler)?\./) ?? [])[1];
if (a && b) {
  console.log(`INFO  DATABASE_URL         user=${a.user} db=${a.db} endpoint=${ep(a.host)} pooled=${/-pooler/.test(a.host)}`);
  console.log(`INFO  DATABASE_MIGRATE_URL user=${b.user} db=${b.db} endpoint=${ep(b.host)} pooled=${/-pooler/.test(b.host)}`);
  ok(a.user === "tend_app" && b.user === "neondb_owner", "runtime login is tend_app, migrate login is neondb_owner");
  ok(/-pooler/.test(a.host) && !/-pooler/.test(b.host), "runtime URL is pooled, migrate URL is direct");
  ok(ep(a.host) && ep(a.host) === ep(b.host), "both URLs point at the SAME endpoint (same branch)");
  ok(a.db === "neondb" && b.db === "neondb", "database is neondb");
  ok(a.ssl === "require" && b.ssl === "require", "sslmode=require on both");
  ok(!!mainHost && /^ep-/.test(mainHost), "--main-host ep-XXXX was given (production's endpoint id, from Neon > Branches > main > Connect)");
  if (mainHost) ok(ep(a.host) !== mainHost && ep(b.host) !== mainHost, `ISOLATION: neither URL points at production's endpoint (${mainHost})`);
} else ok(false, "both database URLs must be valid URLs");

console.log("\n4. Logins work, and tend_app is restricted (read-only queries)");
const { Client } = require("pg");
const q = async (url, sql) => { const c = new Client({ connectionString: url, connectionTimeoutMillis: 15000 }); try { await c.connect(); return (await c.query(sql)).rows[0]; } finally { await c.end().catch(() => {}); } };
const safe = (e) => String(e?.code ?? e?.message ?? e).replace(/postgres(ql)?:\/\/\S+/g, "<url>").slice(0, 120);
try {
  const t = await q(env.DATABASE_URL, "select current_user as u, r.rolsuper, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole, pg_has_role(current_user,'neon_superuser','member') as neon_admin from pg_roles r where r.rolname = current_user");
  ok(t.u === "tend_app", "DATABASE_URL logs in as tend_app (this also proves it is the rehearsal branch: the role only exists there)");
  ok(!t.rolsuper && !t.rolbypassrls && !t.rolcreatedb && !t.rolcreaterole && !t.neon_admin, "tend_app is not superuser, cannot bypass row-level security, cannot create databases or roles, is not a Neon admin");
} catch (e) { ok(false, "DATABASE_URL cannot log in: " + safe(e)); }
try {
  const o = await q(env.DATABASE_MIGRATE_URL, "select current_user as u, current_database() as d, exists(select 1 from pg_roles where rolname='tend_app') as has_app");
  ok(o.u === "neondb_owner" && o.d === "neondb", "DATABASE_MIGRATE_URL logs in as neondb_owner on neondb");
  ok(o.has_app, "the tend_app role exists on this branch");
} catch (e) { ok(false, "DATABASE_MIGRATE_URL cannot log in: " + safe(e)); }

console.log(bad ? `\n${bad} check(s) failed. Fix them before any deploy.` : "\nAll checks passed.");
process.exit(bad ? 1 : 0);
