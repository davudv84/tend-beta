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

/** Why a connection failed, in words, from the error code only (the driver's message can name the host, so it is not printed). */
export function connectReason(e) {
  const known = {
    "3D000": "the database named in the URL does not exist on this endpoint (wrong name, or it was created on another Neon branch)",
    "28P01": "password authentication failed (wrong or rotated password)",
    "28000": "the login is not allowed to connect (no such role, or no LOGIN / CONNECT)",
    "42501": "permission denied (the login lacks CONNECT on the database)",
    "53300": "too many connections", "57P03": "the database is starting up or not accepting connections",
    ENOTFOUND: "the host name does not resolve", ECONNREFUSED: "connection refused", ETIMEDOUT: "connection timed out",
  };
  if (known[e.code]) return known[e.code];
  if (/password authentication/i.test(e.message ?? "")) return known["28P01"];
  if (/does not exist/i.test(e.message ?? "")) return "something named in the URL does not exist (database or role)";
  return "see the code";
}

/**
 * The URL's database does not exist on its endpoint (3D000). Which databases DOES that endpoint have? Same URL, same login, the always-present
 * "postgres" database, read only. Database names are not secret; the answer tells a wrong endpoint (another Neon branch) from a wrong name.
 */
export async function missingDatabase(name, url, expected, connect = readOnly) {
  let names;
  try {
    const u = new URL(url); u.pathname = "/postgres";
    names = (await connect(name, u.toString(), (all) => all("SELECT datname FROM pg_database WHERE NOT datistemplate ORDER BY 1"))).map((r) => String(r.datname));
  } catch (e) { return `${name}: could not list the endpoint's databases either (${e.code ?? "error"}: ${connectReason(e)})`; }
  const list = names.map((n) => JSON.stringify(n)).join(", ") || "none";
  if (names.includes(expected)) return `${name}: the endpoint lists "${expected}" (databases: ${list}) but refused to open it: if this URL is pooled, try the direct host; otherwise the database was created moments ago or is being dropped`;
  const near = names.filter((n) => n.normalize("NFKC").replace(/[\s\u200b-\u200d\ufeff]/g, "").toLowerCase() === expected.toLowerCase());
  if (near.length) return `${name}: the endpoint has ${near.map((n) => `${JSON.stringify(n)} (${n.length} characters)`).join(", ")}, which differs from "${expected}" (${expected.length} characters) in case or invisible characters: the database was created with another exact name`;
  return `${name}: the endpoint in this URL has the databases ${list}, without "${expected}". So this endpoint is NOT the Neon branch where "${expected}" exists: TEND_EXPECT_NEON_ENDPOINT and the URL's host belong to another branch. Copy the host from that branch's Connect dialog (and its ep-… id into TEND_EXPECT_NEON_ENDPOINT)`;
}

/** One connection, one READ ONLY transaction, rolled back: `all(sql)` for the probes. Connection errors name the variable, never the URL. */
async function readOnly(name, url, fn) {
  const client = new pg.Client({ connectionString: verifiedTls(url), connectionTimeoutMillis: 15_000, query_timeout: 15_000 });
  try { await client.connect(); } catch (e) { throw Object.assign(new Error(`${name}: could not connect (${e.code ?? "error"}: ${connectReason(e)})`), { code: e.code }); }
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
    // The targets (database, logins, endpoint) are checkTargets' job above; passing them again would only repeat its findings in other words.
    const pre = checkProductionConfig(env);
    for (const p of pre.problems) if (!problems.includes(p)) problems.push(p);
    // What is wrong with TEND_APP_URL, from its shape only (it is not secret, but the rule is the same: the value is never printed).
    const app = env.TEND_APP_URL ?? "";
    if (app && pre.problems.some((p) => p.startsWith("TEND_APP_URL"))) {
      problems.splice(problems.indexOf(pre.problems.find((p) => p.startsWith("TEND_APP_URL"))), 1); // replaced by the precise message below
      const why = [];
      if (app !== app.trim()) why.push("it has spaces or a line break before or after it");
      const a = app.trim();
      if (!/^https:\/\//.test(a)) why.push(/^http:\/\//.test(a) ? "it starts with http:// (https:// is required)" : "it does not start with https://");
      if (/^https?:\/\/[^/]+\/$/.test(a)) why.push("it ends with a slash (remove it)");
      else if (/^https?:\/\/[^/]+\/./.test(a)) why.push("it has a path after the host (only https://host is allowed)");
      if (/\s/.test(a)) why.push("it contains a space");
      problems.push(`TEND_APP_URL is not exactly https://<host>: ${why.join("; ") || "unrecognised shape"}`);
    }
    warnings.push(...pre.warnings);
    if (env.TEND_ACCOUNTS !== "0" && !(env.RESEND_API_KEY && env.TEND_EMAIL_FROM))
      warnings.push("RESEND_API_KEY and TEND_EMAIL_FROM are not both set: e-mail accounts (sign-up, sign-in) stay off; only the admin token can sign in");
    if (env.TEND_DEMO !== "0") warnings.push("TEND_DEMO is not 0: the demo seeds synthetic data and needs rights the restricted login lacks (set TEND_DEMO=0)");
    facts.push(`TEND_ALLOW_MIGRATIONS ${env.TEND_ALLOW_MIGRATIONS === undefined ? "is unset" : env.TEND_ALLOW_MIGRATIONS === "1" ? "is 1 (migrations approved)" : "is set but not 1 (no approval)"}`);
    const present = ["TEND_CONTEXT_KEY", "TEND_MFA_KEY", "TEND_ADMIN_TOKEN", "TEND_APP_URL", "RESEND_API_KEY", "TEND_EMAIL_FROM", "TEND_DEMO", "TEND_ADMIN"].map((k) => `${k} ${env[k] ? "set" : "unset"}`);
    facts.push(`settings present: ${present.join(", ")}`);
  }
  if (t.enforced && !problems.length) {
    // Each login is probed on its own, so one failing connection does not hide what the other finds.
    for (const [name, probe] of [
      ["DATABASE_URL", (all) => probeRuntime(all, t.targets)],
      ["DATABASE_MIGRATE_URL", (all) => probeOwner(all, t.targets, { allowMigrations: env.TEND_ALLOW_MIGRATIONS === "1" })],
    ]) {
      try { const r = await connect(name, env[name], probe); problems.push(...r.problems); facts.push(...r.facts); }
      catch (e) {
        problems.push(e.message);
        if (e.code === "3D000") problems.push(await missingDatabase(name, env[name], t.targets.db, connect));
      }
    }
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
