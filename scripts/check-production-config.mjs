#!/usr/bin/env node
// Preflight for a production deployment: checks the environment variables a TEND server will start with, without printing any value.
// Run it in the deployment's environment (for Vercel: `vercel env pull .env.preflight` into a temporary file, then
// `node scripts/check-production-config.mjs .env.preflight`, then delete the file) or pass the variables in the environment.
// Exit 0: nothing blocking (warnings may remain). Exit 1: a requirement is not met; the list says which and why. Never prints secrets.
import { readFileSync } from "node:fs";

export function checkProductionConfig(env) {
  const problems = [], warnings = [];
  const need = (ok, msg) => { if (!ok) problems.push(msg); };
  const warn = (ok, msg) => { if (!ok) warnings.push(msg); };
  const url = (v) => { try { return new URL(v); } catch { return undefined; } };
  const db = url(env.DATABASE_URL ?? ""), mig = url(env.DATABASE_MIGRATE_URL ?? "");
  const owner = env.TEND_DB_ALLOW_OWNER_LOGIN === "1";
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
  for (const k of ["TEND_CONTEXT_KEY", "TEND_MFA_KEY", "TEND_ADMIN_TOKEN"]) for (const j of ["TEND_CONTEXT_KEY", "TEND_MFA_KEY", "TEND_ADMIN_TOKEN"])
    if (k < j && env[k] && env[k] === env[j]) problems.push(`${k} and ${j} must be different secrets`);
  return { problems, warnings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = { ...process.env };
  if (process.argv[2]) for (const line of readFileSync(process.argv[2], "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  const { problems, warnings } = checkProductionConfig(env);
  for (const p of problems) console.log(`BLOCKING  ${p}`);
  for (const w of warnings) console.log(`warning   ${w}`);
  console.log(problems.length ? `\n${problems.length} blocking problem(s): this deployment would refuse to start or run unprotected.` : "\nNo blocking problems.");
  process.exit(problems.length ? 1 : 0);
}
