// The deployment check (src/server/deploy-check.mjs, scripts/deploy-check.mjs): validates the real variables inside a Vercel deployment and
// probes both database logins read-only before anything is written. Pure tests always run; the probes run against real PostgreSQL when
// TEND_TEST_DATABASE_URL points at a local superuser (as rls.test.ts).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import pg from "pg";
import { getDb, migrate, MIGRATIONS, postgres, runtimeGrantsSql } from "./db.ts";
import { checkTargets, probeOwner, probeRuntime, SCHEMA_VERSION } from "./deploy-check.mjs";
import { runDeployCheck } from "../../scripts/deploy-check.mjs";

const PW_RT = `rt_${randomBytes(12).toString("hex")}`, PW_OWN = `own_${randomBytes(12).toString("hex")}`;
const EP = "ep-quiet-sky-a1b2c3d4", PROD = "ep-bold-main-z9y8x7w6";
const neon = (user: string, pw: string, ep: string, pooled: boolean, db = "tend_preview") =>
  `postgresql://${user}:${pw}@${ep}${pooled ? "-pooler" : ""}.eu-central-1.aws.neon.tech/${db}?sslmode=require`;
const good = {
  VERCEL: "1", VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "security/release-redesign",
  DATABASE_URL: neon("tend_runtime", PW_RT, EP, true), DATABASE_MIGRATE_URL: neon("neondb_owner", PW_OWN, EP, false),
  TEND_EXPECT_DB: "tend_preview", TEND_EXPECT_NEON_ENDPOINT: EP, TEND_EXPECT_RUNTIME_USER: "tend_runtime", TEND_EXPECT_MIGRATE_USER: "neondb_owner",
  TEND_PRODUCTION_NEON_ENDPOINT: PROD,
};
const leaksNothing = (lines: string[]) => {
  const all = lines.join("\n");
  for (const secret of [PW_RT, PW_OWN, "aws.neon.tech", "db.example.com", "postgresql://"]) assert.ok(!all.includes(secret), `output contains ${secret}: ${all}`);
};

test("DEPLOY-1 the check applies only to Vercel preview and production; elsewhere it says so and blocks nothing", () => {
  for (const env of [{}, { VERCEL_ENV: "development" }, { NODE_ENV: "production" }]) {
    const r = checkTargets(env);
    assert.equal(r.enforced, false); assert.deepEqual(r.problems, []);
  }
  const unknown = checkTargets({ ...good, VERCEL_ENV: undefined });
  assert.ok(unknown.enforced && unknown.problems.some((p) => /VERCEL_ENV is missing/.test(p)), "on Vercel without VERCEL_ENV: fail closed");
});

test("DEPLOY-2 a correct preview passes, and the report names logins, databases and endpoint matches only, never a password or host", () => {
  const r = checkTargets(good);
  assert.deepEqual(r.problems, []);
  assert.ok(r.facts.some((f) => /DATABASE_URL: login tend_runtime, database tend_preview, Neon endpoint matches TEND_EXPECT_NEON_ENDPOINT, pooled/.test(f)), r.facts.join(" | "));
  assert.ok(r.facts.some((f) => /DATABASE_MIGRATE_URL: login neondb_owner, .* direct/.test(f)));
  leaksNothing([...r.facts, ...r.problems]);
});

test("DEPLOY-3 every target is required on a preview, and each mismatch is blocking and named", () => {
  for (const k of ["TEND_EXPECT_DB", "TEND_EXPECT_NEON_ENDPOINT", "TEND_EXPECT_RUNTIME_USER", "TEND_EXPECT_MIGRATE_USER", "TEND_PRODUCTION_NEON_ENDPOINT", "DATABASE_URL", "DATABASE_MIGRATE_URL"]) {
    const r = checkTargets({ ...good, [k]: undefined });
    assert.ok(r.problems.some((p) => p.includes(k)), `${k} missing: ${r.problems.join(" | ")}`);
  }
  const cases: [Record<string, string>, RegExp][] = [
    [{ DATABASE_URL: neon("neondb_owner", PW_RT, EP, true) }, /DATABASE_URL logs in as "neondb_owner", expected the runtime login "tend_runtime"/],
    [{ DATABASE_MIGRATE_URL: neon("tend_runtime", PW_OWN, EP, false) }, /DATABASE_MIGRATE_URL logs in as "tend_runtime", expected the owner login/],
    [{ DATABASE_URL: neon("tend_runtime", PW_RT, EP, true, "neondb") }, /DATABASE_URL targets database "neondb", expected "tend_preview"/],
    [{ DATABASE_MIGRATE_URL: neon("neondb_owner", PW_OWN, "ep-other-branch-q1w2e3", false) }, /DATABASE_MIGRATE_URL is not on TEND_EXPECT_NEON_ENDPOINT/],
    [{ DATABASE_URL: neon("tend_runtime", "", EP, true) }, /DATABASE_URL has no password in it/],
    [{ DATABASE_URL: "[SENSITIVE]" }, /DATABASE_URL holds a placeholder/],
    [{ DATABASE_URL: `postgresql://tend_runtime:${PW_RT}@db.example.com/tend_preview?sslmode=require` }, /DATABASE_URL is not a Neon host/],
    [{ DATABASE_URL: neon("tend_runtime", PW_RT, EP, true).replace("?sslmode=require", "") }, /DATABASE_URL has no sslmode=require/],
    [{ TEND_EXPECT_RUNTIME_USER: "neondb_owner" }, /must be different logins/],
  ];
  for (const [change, want] of cases) {
    const r = checkTargets({ ...good, ...change });
    assert.ok(r.problems.some((p) => want.test(p)), `${want}: ${r.problems.join(" | ")}`);
    leaksNothing([...r.facts, ...r.problems]);
  }
});

test("DEPLOY-4 a preview can never reach production: not by its URLs, not by a declared target, not by any other variable", () => {
  const onProd = checkTargets({ ...good, DATABASE_URL: neon("tend_runtime", PW_RT, PROD, true) });
  assert.ok(onProd.problems.some((p) => /DATABASE_URL is on the PRODUCTION Neon endpoint/.test(p)), onProd.problems.join(" | "));
  const declared = checkTargets({ ...good, TEND_EXPECT_NEON_ENDPOINT: PROD, DATABASE_URL: neon("tend_runtime", PW_RT, PROD, true), DATABASE_MIGRATE_URL: neon("neondb_owner", PW_OWN, PROD, false) });
  assert.ok(declared.problems.some((p) => /TEND_EXPECT_NEON_ENDPOINT is the production endpoint/.test(p)));
  // an integration's variables next to ours (Neon's integration adds these), pointing at production
  const leak = checkTargets({ ...good, POSTGRES_URL: neon("neondb_owner", "x".repeat(20), PROD, true, "neondb"), PGHOST: `${PROD}.eu-central-1.aws.neon.tech` });
  assert.ok(leak.problems.some((p) => /^POSTGRES_URL refers to the production Neon endpoint/.test(p)));
  assert.ok(leak.problems.some((p) => /^PGHOST refers to the production Neon endpoint/.test(p)));
  leaksNothing([...leak.facts, ...leak.problems]);
  assert.ok(checkTargets(good).facts.some((f) => /production endpoint referenced by no variable/.test(f)));
  // production itself: its own endpoint is the expected one, and the rule is consistent
  const prod = { ...good, VERCEL_ENV: "production", DATABASE_URL: neon("tend_runtime", PW_RT, PROD, true), DATABASE_MIGRATE_URL: neon("neondb_owner", PW_OWN, PROD, false), TEND_EXPECT_NEON_ENDPOINT: PROD };
  assert.deepEqual(checkTargets(prod).problems, []);
  assert.ok(checkTargets({ ...prod, TEND_EXPECT_NEON_ENDPOINT: EP }).problems.some((p) => /differs from TEND_PRODUCTION_NEON_ENDPOINT/.test(p)));
});

test("DEPLOY-5 the release's schema version is the migration count", () => {
  assert.equal(SCHEMA_VERSION, MIGRATIONS.length);
});

test("DEPLOY-6 server start on a preview with a wrong target is refused before any connection is made", async () => {
  const g = globalThis as { __tendDb?: Promise<unknown> };
  const keys = Object.keys(good).concat(["POSTGRES_URL", "TEND_DATA_DIR"]);
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  // Port 1 on loopback: a connection attempt would fail with ECONNREFUSED, so the refusal message proves nothing connected.
  Object.assign(process.env, good, { DATABASE_URL: neon("tend_runtime", PW_RT, PROD, true), TEND_DATA_DIR: mkdtempSync(path.join(tmpdir(), "tend-deploy-")) });
  g.__tendDb = undefined;
  try {
    const e = await getDb().then(() => undefined, (x: Error) => x);
    assert.match(String(e?.message), /^deployment check: .*DATABASE_URL is on the PRODUCTION Neon endpoint.*Nothing was changed in the database\.$/);
    leaksNothing([String(e?.message)]);
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    g.__tendDb = undefined;
  }
});

test("DEPLOY-7 the build step: exit 0 where it does not apply, exit 1 with named problems (and no connection) when a target is wrong", async () => {
  const out: string[] = [];
  assert.equal(await runDeployCheck({}, (l: string) => out.push(l)), 0);
  out.length = 0;
  assert.equal(await runDeployCheck({ ...good, DATABASE_URL: neon("tend_runtime", PW_RT, PROD, true) }, (l: string) => out.push(l)), 1);
  assert.ok(out.some((l) => /BLOCKING DATABASE_URL is on the PRODUCTION Neon endpoint/.test(l)), out.join("\n"));
  assert.ok(out.some((l) => /database checks not run/.test(l)));
  assert.ok(out.some((l) => /stopping before deployment\. Nothing was written/.test(l)));
  leaksNothing(out);
});

// ---- real PostgreSQL --------------------------------------------------------------------------------------------------------------

const URL_ = process.env.TEND_TEST_DATABASE_URL ?? "";
const ROLE_PW = (() => { try { return decodeURIComponent(new URL(URL_).password).replace(/'/g, "''"); } catch { return ""; } })() || "tend-test-login";
const skip = URL_ ? false : "set TEND_TEST_DATABASE_URL (or run `npm run test:postgres`) to test against real PostgreSQL";

/** The probes' contract: one READ ONLY transaction, rolled back. */
async function readOnly<T>(url: string, fn: (all: (sql: string) => Promise<Record<string, unknown>[]>) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { await c.query("BEGIN TRANSACTION READ ONLY"); return await fn(async (sql) => (await c.query(sql)).rows); }
  finally { await c.query("ROLLBACK").catch(() => {}); await c.end(); }
}

test("DEPLOY-PG probes on real PostgreSQL: a clean runtime login passes, every escalation is caught, pending migrations need approval, nothing is written", { skip }, async () => {
  const host = new URL(URL_).hostname;
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) throw new Error("TEND_TEST_DATABASE_URL must point at this machine");
  const admin = new pg.Client({ connectionString: URL_ });
  await admin.connect();
  const tag = randomBytes(4).toString("hex"), name = `tend_dc_${tag}`, owner = `tend_dco_${tag}`, login = `tend_dcr_${tag}`, bypass = `tend_dcb_${tag}`;
  const urlFor = (user: string) => { const u = new URL(URL_); u.username = user; u.password = ROLE_PW; u.pathname = `/${name}`; return u.toString(); };
  const targets = { db: name, runtimeUser: login, migrateUser: owner };
  try {
    await admin.query(`CREATE ROLE ${owner} LOGIN PASSWORD '${ROLE_PW}' NOSUPERUSER CREATEDB CREATEROLE NOBYPASSRLS`); // like neondb_owner
    await admin.query(`CREATE DATABASE ${name} OWNER ${owner}`);
    await admin.query(`CREATE ROLE ${login} LOGIN PASSWORD '${ROLE_PW}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    await admin.query(`GRANT CONNECT ON DATABASE ${name} TO ${login}`);
    const inDb = new pg.Client({ connectionString: (() => { const u = new URL(URL_); u.pathname = `/${name}`; return u.toString(); })() });
    await inDb.connect();
    await inDb.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC"); // PostgreSQL 15+ and Neon default; older test servers need it said
    await inDb.end();

    // 1. empty database: runtime clean; owner sees version 0 and 26 pending, refused without approval, accepted with it
    const rt0 = await readOnly(urlFor(login), (all) => probeRuntime(all, targets));
    assert.deepEqual(rt0.problems, [], rt0.facts.join(" | "));
    assert.ok(rt0.facts[0].includes("access to tend_context_keys n/a (no schema yet)"));
    const ow0 = await readOnly(urlFor(owner), (all) => probeOwner(all, targets));
    assert.equal(ow0.pending, MIGRATIONS.length);
    assert.ok(ow0.problems.some((p) => new RegExp(`^${MIGRATIONS.length} migration\\(s\\) would run .* set TEND_ALLOW_MIGRATIONS=1`).test(p)), ow0.problems.join(" | "));
    assert.deepEqual((await readOnly(urlFor(owner), (all) => probeOwner(all, targets, { allowMigrations: true }))).problems, []);
    assert.equal((await admin.query(`SELECT 1 FROM pg_database WHERE datname = '${name}'`)).rowCount, 1);
    const tables = async () => { const c = new pg.Client({ connectionString: urlFor(owner) }); await c.connect(); try { return (await c.query("SELECT count(*)::int AS n FROM pg_class WHERE relnamespace = 'public'::regnamespace")).rows[0].n; } finally { await c.end(); } };
    assert.equal(await tables(), 0, "the probes created nothing");

    // 2. the probe connection really is read-only: a write through the same `all` is refused by PostgreSQL
    await assert.rejects(readOnly(urlFor(owner), (all) => all("CREATE TABLE should_not_exist (i int)")), /read-only transaction/);
    // and the server's own wrapper (db.ts: tx + SET TRANSACTION READ ONLY after the transaction's SET LOCALs) is read-only too
    const ownerDb = await postgres(urlFor(owner));
    await assert.rejects(ownerDb.tx(async (q) => { await q.exec("SET TRANSACTION READ ONLY"); await q.exec("CREATE TABLE should_not_exist (i int)"); }), /read-only transaction/);
    assert.equal(await tables(), 0);

    // 3. migrated and granted as start-up does: version 26, nothing pending, owner owns, runtime still clean and without the keys
    await migrate(ownerDb);
    await ownerDb.exec(runtimeGrantsSql(login));
    await ownerDb.close();
    const ow1 = await readOnly(urlFor(owner), (all) => probeOwner(all, targets));
    assert.deepEqual(ow1.problems, []); assert.equal(ow1.version, MIGRATIONS.length); assert.equal(ow1.pending, 0);
    const rt1 = await readOnly(urlFor(login), (all) => probeRuntime(all, targets));
    assert.deepEqual(rt1.problems, [], rt1.facts.join(" | "));
    assert.ok(rt1.facts[0].includes("access to tend_context_keys false"));

    // 4. each escalation of the runtime login is caught (and undone after)
    const caught = async (grant: string, revoke: string, want: RegExp) => {
      await admin.query(grant);
      try { const r = await readOnly(urlFor(login), (all) => probeRuntime(all, targets)); assert.ok(r.problems.some((p) => want.test(p)), `${grant}: ${r.problems.join(" | ")}`); }
      finally { await admin.query(revoke); }
    };
    await caught(`ALTER ROLE ${login} BYPASSRLS`, `ALTER ROLE ${login} NOBYPASSRLS`, /has BYPASSRLS/);
    await caught(`ALTER ROLE ${login} CREATEDB`, `ALTER ROLE ${login} NOCREATEDB`, /has CREATEDB/);
    await caught(`ALTER ROLE ${login} CREATEROLE`, `ALTER ROLE ${login} NOCREATEROLE`, /has CREATEROLE/);
    await admin.query(`CREATE ROLE ${bypass} NOLOGIN BYPASSRLS`);
    await caught(`GRANT ${bypass} TO ${login}`, `REVOKE ${bypass} FROM ${login}`, new RegExp(`member of privileged role\\(s\\) ${bypass}`));
    await caught(`GRANT ${owner} TO ${login}`, `REVOKE ${owner} FROM ${login}`, /owns TEND's tables, or is a member of their owner/);
    const asOwner = async (sql: string) => { const c = new pg.Client({ connectionString: urlFor(owner) }); await c.connect(); try { await c.query(sql); } finally { await c.end(); } };
    await asOwner(`GRANT SELECT ON tend_context_keys TO ${login}`);
    try { const r = await readOnly(urlFor(login), (all) => probeRuntime(all, targets)); assert.ok(r.problems.some((p) => /has privileges on tend_context_keys/.test(p)), r.problems.join(" | ")); }
    finally { await asOwner(`REVOKE ALL ON tend_context_keys FROM ${login}`); }
    await asOwner(`GRANT CREATE ON SCHEMA public TO ${login}`);
    try { const r = await readOnly(urlFor(login), (all) => probeRuntime(all, targets)); assert.ok(r.problems.some((p) => /may create objects in schema public/.test(p))); }
    finally { await asOwner(`REVOKE CREATE ON SCHEMA public FROM ${login}`); }

    // 5. wrong login or database for the declared target
    const wrong = await readOnly(urlFor(login), (all) => probeRuntime(all, { ...targets, runtimeUser: "tend_runtime", db: "other" }));
    assert.ok(wrong.problems.some((p) => /DATABASE_URL connected as ".*", expected "tend_runtime"/.test(p)));
    assert.ok(wrong.problems.some((p) => /DATABASE_URL connected to database ".*", expected "other"/.test(p)));
    const notOwner = await readOnly(urlFor(login), (all) => probeOwner(all, { ...targets, migrateUser: login }));
    assert.ok(notOwner.problems.some((p) => /does not own TEND's tables/.test(p)), notOwner.problems.join(" | "));
    leaksNothing([...rt1.facts, ...ow1.facts, ...wrong.problems]);
    for (const s of [...rt1.facts, ...ow1.facts]) assert.ok(!s.includes(ROLE_PW), "no password in the report");
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => {});
    for (const r of [login, bypass, owner]) await admin.query(`DROP ROLE IF EXISTS ${r}`).catch(() => {});
    await admin.end();
  }
});

test("DEPLOY-8 the build step also checks the secrets and settings the server needs, on the real values, naming them without values", async () => {
  const out: string[] = [];
  // all targets right, but no secrets at all: blocked before any connection, each missing secret named
  assert.equal(await runDeployCheck({ ...good }, (l: string) => out.push(l)), 1);
  for (const want of [/BLOCKING TEND_CONTEXT_KEY must be set/, /BLOCKING TEND_ADMIN_TOKEN must be at least 32/, /BLOCKING TEND_APP_URL must be the https/, /TEND_ALLOW_MIGRATIONS is unset/, /settings present: TEND_CONTEXT_KEY unset/, /database checks not run/])
    assert.ok(out.some((l) => want.test(l)), `${want}\n${out.join("\n")}`);
  leaksNothing(out);
  // a key that is too short, and two secrets that are the same, are blocking; the values are never printed
  out.length = 0;
  const key = "k".repeat(20), same = randomBytes(24).toString("hex");
  await runDeployCheck({ ...good, TEND_CONTEXT_KEY: key, TEND_MFA_KEY: same, TEND_ADMIN_TOKEN: same, TEND_APP_URL: "https://tend-preview.example.app", TEND_ALLOW_MIGRATIONS: "1" }, (l: string) => out.push(l));
  assert.ok(out.some((l) => /BLOCKING TEND_CONTEXT_KEY must be set, at least 32/.test(l)), out.join("\n"));
  assert.ok(out.some((l) => /BLOCKING TEND_ADMIN_TOKEN and TEND_MFA_KEY must be different secrets/.test(l)));
  assert.ok(out.some((l) => /TEND_ALLOW_MIGRATIONS is 1 \(migrations approved\)/.test(l)));
  assert.ok(!out.join("\n").includes(key) && !out.join("\n").includes(same), "no secret value in the output");
});

test("DEPLOY-9 a check-only build never deploys: it stops after the checks even when they all pass; outside Vercel it changes nothing", async () => {
  const out: string[] = [];
  // the targets fail here (no database to probe), so check-only adds nothing: still blocked by the problems
  assert.equal(await runDeployCheck({ ...good }, (l: string) => out.push(l), { checkOnly: true }), 1);
  assert.ok(!out.some((l) => /CHECK-ONLY/.test(l)));
  // not a Vercel deployment: the marker does not break local or CI builds
  out.length = 0;
  assert.equal(await runDeployCheck({}, (l: string) => out.push(l), { checkOnly: true }), 0);
});

test("DEPLOY-10 when every check passes: a normal build continues (exit 0); a check-only build stops (exit 1) and says nothing was deployed", async () => {
  const secrets = { TEND_CONTEXT_KEY: randomBytes(36).toString("base64url"), TEND_MFA_KEY: randomBytes(36).toString("base64url"), TEND_ADMIN_TOKEN: randomBytes(32).toString("hex"),
    TEND_APP_URL: "https://tend-preview.example.app", TEND_DEMO: "0" };
  // A database that answers the probes as a clean preview at schema 26 would (the probes' SQL is covered on real PostgreSQL by DEPLOY-PG).
  const rows: Record<string, Record<string, unknown>[]> = {
    runtime: [{ login: "tend_runtime", who: "tend_runtime", db: "tend_preview", sup: false, bypass: false, createrole: false, createdb: false, privileged: "", owns: false, createpublic: false, schema: true, keys: false, ro: "on" }],
    owner: [{ login: "neondb_owner", db: "tend_preview", ro: "on", history: true, meta: true, owns: true }],
    versions: Array.from({ length: SCHEMA_VERSION }, (_, i) => ({ version: i + 1 })),
  };
  const connect = async <T>(name: string, _url: string | undefined, fn: (all: (sql: string) => Promise<Record<string, unknown>[]>) => Promise<T>) =>
    fn(async (sql) => (/schema_migrations ORDER BY/.test(sql) ? rows.versions : name === "DATABASE_URL" ? rows.runtime : rows.owner));
  const out: string[] = [];
  assert.equal(await runDeployCheck({ ...good, ...secrets }, (l: string) => out.push(l), { checkOnly: false, connect }), 0, out.join("\n"));
  assert.ok(out.some((l) => /Deployment check passed/.test(l)));
  out.length = 0;
  assert.equal(await runDeployCheck({ ...good, ...secrets }, (l: string) => out.push(l), { checkOnly: true, connect }), 1);
  assert.ok(out.some((l) => /CHECK-ONLY build .* Nothing is deployed\./.test(l)), out.join("\n"));
  for (const v of Object.values(secrets)) if (v.length > 4) assert.ok(!out.join("\n").includes(v) || v === "0", "no secret value printed");
  // pending migrations still block, whatever the mode
  rows.versions = rows.versions.slice(0, -1);
  out.length = 0;
  assert.equal(await runDeployCheck({ ...good, ...secrets }, (l: string) => out.push(l), { checkOnly: false, connect }), 1);
  assert.ok(out.some((l) => /BLOCKING 1 migration\(s\) would run \(version 26\)/.test(l)), out.join("\n"));
});
