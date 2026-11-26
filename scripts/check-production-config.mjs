#!/usr/bin/env node
// Preflight for a production deployment: checks the environment variables a TEND server will start with, without printing any value.
// Run it in the deployment's environment (for Vercel: `vercel env pull .env.preflight` into a temporary file, then
// `node scripts/check-production-config.mjs .env.preflight`, then delete the file) or pass the variables in the environment.
// Exit 0: nothing blocking (warnings may remain). Exit 1: a requirement is not met; the list says which and why. Never prints secrets.
//
// Optional identity checks (names only, never values): --expect-db <name>  --runtime-user <login>  --migrate-user <login>
//   node scripts/check-production-config.mjs .env.preflight --expect-db tend_preview_fresh --runtime-user tend_runtime_v2 --migrate-user neondb_owner
// They fail when a URL points at another database or logs in as another role, so a preview cannot be checked against the wrong database.
import { readFileSync } from "node:fs";

export function checkProductionConfig(env, expect = {}) {
  const problems = [], warnings = [];
  const need = (ok, msg) => { if (!ok) problems.push(msg); };
  const warn = (ok, msg) => { if (!ok) warnings.push(msg); };
  const url = (v) => { try { return new URL(v); } catch { return undefined; } };
  const db = url(env.DATABASE_URL ?? ""), mig = url(env.DATABASE_MIGRATE_URL ?? "");
  // The exception only applies to a deployment that really has one owner URL; with a separate migration login everything else still applies.
  const owner = env.TEND_DB_ALLOW_OWNER_LOGIN === "1" && !mig;
  need(!!db && /^postgres(ql)?:$/.test(db.protocol), "DATABASE_URL must be a PostgreSQL URL");
  if (!owner) {
    need(!!mig, "DATABASE_MIGRATE_URL (the schema owner, used only at start-up) must be set: production refuses an owner login on DATABASE_URL");
    need(!db || !mig || db.username !== mig.username, "DATABASE_URL and DATABASE_MIGRATE_URL must be different logins (the runtime one restricted)");
    need((env.TEND_CONTEXT_KEY ?? "").length >= 32, "TEND_CONTEXT_KEY must be set, at least 32 random characters");
  } else warnings.push("TEND_DB_ALLOW_OWNER_LOGIN=1: the application logs in as the schema owner; row-level security does not stop SQL injection");
  for (const u of [db, mig]) if (u) warn(/^(require|verify-full|verify-ca)$/.test(u.searchParams.get("sslmode") ?? "") || ["127.0.0.1", "localhost"].includes(u.hostname), `${u === db ? "DATABASE_URL" : "DATABASE_MIGRATE_URL"} has no sslmode=require (or stronger)`);
  need(!/^(off|0)$/i.test(env.TEND_DB_ISOLATION ?? ""), "TEND_DB_ISOLATION must not be off");
  need(!/^(off|0)$/i.test(env.TEND_DB_STRICT ?? ""), "TEND_DB_STRICT must not be off in production");
  const admin = env.TEND_ADMIN_TOKEN ?? "";
  need(env.TEND_ADMIN === "0" || (admin.length >= 32 && new Set(admin).size >= 10), "TEND_ADMIN_TOKEN must be at least 32 random characters (or TEND_ADMIN=0)");
  need(/^https:\/\/[^\s/]+$/.test(env.TEND_APP_URL ?? ""), "TEND_APP_URL must be the https:// origin of the deployment");
  warn((env.TEND_MFA_KEY ?? "").length >= 32, "TEND_MFA_KEY is not set: accounts cannot turn on two-step sign-in");
  warn(!env.TEND_ALERT_WEBHOOK_URL || /^https:\/\//.test(env.TEND_ALERT_WEBHOOK_URL), "TEND_ALERT_WEBHOOK_URL must be https (it is ignored otherwise)");
  warn(!!env.TEND_ALERT_WEBHOOK_URL, "TEND_ALERT_WEBHOOK_URL is not set: alerts only reach the log");
  warn(env.TEND_PUBLIC !== "1", "TEND_PUBLIC=1: visitors see the default workspace's activity");
  // Both URLs must lead to the same database (the owner migrates what the runtime login then serves); they differ only in login and, on Neon,
  // in the pooled host ("-pooler"). Names only are compared and printed, never a password or a host.
  const dbName = (u) => decodeURIComponent(u.pathname.replace(/^\//, ""));
  if (db && mig && !owner) {
    need(dbName(db) === dbName(mig), `DATABASE_URL and DATABASE_MIGRATE_URL name different databases (${dbName(db) || "none"} and ${dbName(mig) || "none"}): the owner would migrate one database and the application run on another`);
    warn(db.hostname.replace(/-pooler(?=\.)/, "") === mig.hostname.replace(/-pooler(?=\.)/, ""), "DATABASE_URL and DATABASE_MIGRATE_URL are on different hosts (beyond Neon's -pooler suffix): check that both are the same branch");
  }
  if (expect.db && db) need(dbName(db) === expect.db, `DATABASE_URL targets database "${dbName(db) || "none"}", expected "${expect.db}"`);
  if (expect.db && mig) need(dbName(mig) === expect.db, `DATABASE_MIGRATE_URL targets database "${dbName(mig) || "none"}", expected "${expect.db}"`);
  if (expect.runtimeUser && db) need(decodeURIComponent(db.username) === expect.runtimeUser, `DATABASE_URL logs in as "${decodeURIComponent(db.username) || "none"}", expected the runtime login "${expect.runtimeUser}"`);
  if (expect.migrateUser && mig) need(decodeURIComponent(mig.username) === expect.migrateUser, `DATABASE_MIGRATE_URL logs in as "${decodeURIComponent(mig.username) || "none"}", expected the migration login "${expect.migrateUser}"`);
  for (const k of ["TEND_CONTEXT_KEY", "TEND_MFA_KEY", "TEND_ADMIN_TOKEN"]) for (const j of ["TEND_CONTEXT_KEY", "TEND_MFA_KEY", "TEND_ADMIN_TOKEN"])
    if (k < j && env[k] && env[k] === env[j]) problems.push(`${k} and ${j} must be different secrets`);
  return { problems, warnings };
}

const REQUIRED = ["DATABASE_URL", "DATABASE_MIGRATE_URL", "TEND_CONTEXT_KEY", "TEND_MFA_KEY", "TEND_ADMIN_TOKEN"];

/**
 * Why the values may be wrong, from their shape only (never their content). Several different settings holding one identical value cannot be
 * real: secrets are generated separately and a database URL is not a secret key. That is what a placeholder, or a value that was not exported
 * to this file, looks like, and fixing each variable one by one would not help.
 */
export function explainShape(env) {
  const lines = [];
  const groups = new Map();
  for (const k of REQUIRED) if (env[k]) groups.set(env[k], [...(groups.get(env[k]) ?? []), k]);
  for (const [v, names] of groups) if (names.length >= 3)
    lines.push(`${names.join(", ")} all hold exactly the same value (${v.length} characters). Real settings are distinct, so this is a placeholder or a value that was not exported into this file; check where the file came from before touching the variables.`);
  for (const k of ["DATABASE_URL", "DATABASE_MIGRATE_URL"]) {
    const v = env[k];
    if (v && !/^postgres(ql)?:\/\//.test(v)) lines.push(`${k} is ${v.length} characters and has no postgres:// scheme, so it is not a connection string.`);
    if (!v && env[k] !== undefined) lines.push(`${k} is present but empty.`);
  }
  for (const k of REQUIRED) if (env[k] === undefined) lines.push(`${k} is not in the file or the environment at all (not exported, or scoped to another environment or branch).`);
  return lines;
}

/** KEY=value lines of a dotenv file: LF or CRLF, an optional `export `, one pair of matching quotes. No value leaves this function except into the checks. */
export function parseEnvFile(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(raw);
    if (!m) continue;
    const q = /^(["'])([\s\S]*)\1$/.exec(m[2]);
    out[m[1]] = q ? q[2] : m[2];
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const flag = (n) => { const i = args.indexOf(`--${n}`); return i < 0 ? undefined : args.splice(i, 2)[1]; };
  const expect = { db: flag("expect-db"), runtimeUser: flag("runtime-user"), migrateUser: flag("migrate-user") };
  // From the file only when one is given: a variable left in the shell must not stand in for one the deployment lacks.
  const env = args[0] ? parseEnvFile(readFileSync(args[0], "utf8")) : { ...process.env };
  const { problems, warnings } = checkProductionConfig(env, expect);
  for (const p of problems) console.log(`BLOCKING  ${p}`);
  for (const w of warnings) console.log(`warning   ${w}`);
  if (problems.length) for (const l of explainShape(env)) console.log(`hint      ${l}`);
  console.log(problems.length ? `\n${problems.length} blocking problem(s): this deployment would refuse to start or run unprotected.` : "\nNo blocking problems.");
  process.exit(problems.length ? 1 : 0);
}
