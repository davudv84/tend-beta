#!/usr/bin/env node
// Deployment check, run by `npm run build` before `next build` (src/server/deploy-check.mjs says what it proves). On a Vercel preview or
// production build it validates the REAL environment variables (Sensitive ones included, which `vercel env pull` cannot show) and runs the
// read-only database checks; any problem exits 1, so the build fails and nothing is deployed. Elsewhere (local, CI) it reports that it does
// not apply and exits 0. It never writes to a database and never prints a password, token, connection string or host.
import pg from "pg";
import { checkTargets, probeOwner, probeRuntime } from "../src/server/deploy-check.mjs";

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

/** @param {Record<string, string | undefined>} [env] @param {(line: string) => void} [log] */
export async function runDeployCheck(env = process.env, log = console.log) {
  const t = checkTargets(env);
  const problems = [...t.problems], facts = [...t.facts];
  if (t.enforced && !problems.length) {
    try {
      const rt = await readOnly("DATABASE_URL", env.DATABASE_URL, (all) => probeRuntime(all, t.targets));
      problems.push(...rt.problems); facts.push(...rt.facts);
      const ow = await readOnly("DATABASE_MIGRATE_URL", env.DATABASE_MIGRATE_URL, (all) => probeOwner(all, t.targets, { allowMigrations: env.TEND_ALLOW_MIGRATIONS === "1" }));
      problems.push(...ow.problems); facts.push(...ow.facts);
    } catch (e) { problems.push(e.message); }
  } else if (t.enforced) facts.push("database checks not run: the variables above must be fixed first (nothing was connected to)");
  log(`TEND deployment check (VERCEL_ENV=${t.vercelEnv}${env.VERCEL_GIT_COMMIT_REF ? `, branch ${env.VERCEL_GIT_COMMIT_REF}` : ""})`);
  for (const f of facts) log(`  info     ${f}`);
  for (const p of problems) log(`  BLOCKING ${p}`);
  log(problems.length ? `${problems.length} blocking problem(s): stopping before deployment. Nothing was written to any database.` : t.enforced ? "Deployment check passed (read-only; nothing was written)." : "");
  return problems.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await runDeployCheck());
