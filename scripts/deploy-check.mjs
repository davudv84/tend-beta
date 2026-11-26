#!/usr/bin/env node
// Deployment check, run by `npm run build` before `next build` (src/server/deploy-check.mjs says what it proves). On a Vercel preview or
// production build it validates the REAL environment variables (Sensitive ones included, which `vercel env pull` cannot show) and runs the
// read-only database checks; any problem exits 1, so the build fails and nothing is deployed. Elsewhere (local, CI) it reports that it does
// not apply and exits 0. It never writes to a database and never prints a password, token, connection string or host.
import { existsSync } from "node:fs";
import pg from "pg";
import { checkTargets, probeOwner, probeRuntime } from "../src/server/deploy-check.mjs";
import { checkProductionConfig } from "./check-production-config.mjs";

// The server's TLS rule (db.ts verifiedTls): anything weaker than verify-full is upgraded; never downgraded.
function verifiedTls(url) {
  const u = new URL(url);
  const mode = u.searchParams.get("sslmode");
  if (mode === null || ["allow", "prefer", "require", "verify-ca"].includes(mode)) { u.searchParams.set("sslmode", "verify-full"); u.searchParams.delete("uselibpqcompat"); }
  return u.toString();
}

/** One connection, one READ ONLY transaction, rolled back: `all(sql)` for the probes. Connection errors name the variable, never the URL. */
async function readOnly(name, url, fn) {
  const client = new pg.Client({ connectionString: verifiedTls(url), connectionTimeoutMillis: 15_000, query_timeout: 15_000 });
  try { await client.connect(); } catch (e) { throw new Error(`${name}: could not connect (${e.code ?? "error"}${/password authentication/i.test(e.message) ? ": password authentication failed" : ""})`); }
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    await client.query("SET LOCAL statement_timeout = 15000");
    return await fn(async (sql) => (await client.query(sql)).rows);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
}

/**
 * A committed DEPLOY_CHECK_ONLY file at the repository root makes a build check-only: every check runs (the database probes included, read
 * only) and the build then stops before `next build` even when all pass, so verifying a configuration never deploys it. Deploying is a
 * separate, reviewed commit that removes the file.
 */
export const CHECK_ONLY_MARKER = new URL("../DEPLOY_CHECK_ONLY", import.meta.url);

/** @param {Record<string, string | undefined>} [env] @param {(line: string) => void} [log] @param {{ checkOnly?: boolean, connect?: typeof readOnly }} [opts] */
export async function runDeployCheck(env = process.env, log = console.log, { checkOnly = existsSync(CHECK_ONLY_MARKER), connect = readOnly } = {}) {
  const t = checkTargets(env);
  const problems = [...t.problems], facts = [...t.facts], warnings = [];
  if (t.enforced) {
    // The secrets and security settings the server needs (the same rules as the local preflight), on the real values: lengths, formats and
    // distinctness only, never a value.
    const pre = checkProductionConfig(env, { db: t.targets?.db, runtimeUser: t.targets?.runtimeUser, migrateUser: t.targets?.migrateUser, endpoint: t.targets?.endpoint });
    for (const p of pre.problems) if (!problems.includes(p)) problems.push(p);
    warnings.push(...pre.warnings);
    if (env.TEND_ACCOUNTS !== "0" && !(env.RESEND_API_KEY && env.TEND_EMAIL_FROM))
      warnings.push("RESEND_API_KEY and TEND_EMAIL_FROM are not both set: e-mail accounts (sign-up, sign-in) stay off; only the admin token can sign in");
    if (env.TEND_DEMO !== "0") warnings.push("TEND_DEMO is not 0: the demo seeds synthetic data and needs rights the restricted login lacks (set TEND_DEMO=0)");
    facts.push(`TEND_ALLOW_MIGRATIONS ${env.TEND_ALLOW_MIGRATIONS === undefined ? "is unset" : env.TEND_ALLOW_MIGRATIONS === "1" ? "is 1 (migrations approved)" : "is set but not 1 (no approval)"}`);
    const present = ["TEND_CONTEXT_KEY", "TEND_MFA_KEY", "TEND_ADMIN_TOKEN", "TEND_APP_URL", "RESEND_API_KEY", "TEND_EMAIL_FROM", "TEND_DEMO", "TEND_ADMIN"].map((k) => `${k} ${env[k] ? "set" : "unset"}`);
    facts.push(`settings present: ${present.join(", ")}`);
  }
  if (t.enforced && !problems.length) {
    try {
      const rt = await connect("DATABASE_URL", env.DATABASE_URL, (all) => probeRuntime(all, t.targets));
      problems.push(...rt.problems); facts.push(...rt.facts);
      const ow = await connect("DATABASE_MIGRATE_URL", env.DATABASE_MIGRATE_URL, (all) => probeOwner(all, t.targets, { allowMigrations: env.TEND_ALLOW_MIGRATIONS === "1" }));
      problems.push(...ow.problems); facts.push(...ow.facts);
    } catch (e) { problems.push(e.message); }
  } else if (t.enforced) facts.push("database checks not run: the variables above must be fixed first (nothing was connected to)");
  log(`TEND deployment check (VERCEL_ENV=${t.vercelEnv}${env.VERCEL_GIT_COMMIT_REF ? `, branch ${env.VERCEL_GIT_COMMIT_REF}` : ""})`);
  for (const f of facts) log(`  info     ${f}`);
  for (const w of warnings) log(`  warning  ${w}`);
  for (const p of problems) log(`  BLOCKING ${p}`);
  log(problems.length ? `${problems.length} blocking problem(s): stopping before deployment. Nothing was written to any database.` : t.enforced ? "Deployment check passed (read-only; nothing was written)." : "");
  if (problems.length) return 1;
  if (t.enforced && checkOnly) {
    log("CHECK-ONLY build (DEPLOY_CHECK_ONLY is in this commit): all checks passed; stopping before `next build` on purpose. Nothing is deployed.");
    return 1;
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await runDeployCheck());
