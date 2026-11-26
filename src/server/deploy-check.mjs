// Deployment check: run INSIDE the Vercel deployment, where the real environment variables are (a local `vercel env pull` replaces
// Sensitive variables with placeholders, so it cannot validate them). Used twice, with the same rules:
//   - in the Vercel build, before `next build` (scripts/deploy-check.mjs): a failed check fails the build, so nothing is deployed;
//   - at every server start, before the first migration or other write (src/server/db.ts open()), in case a variable changed after the build.
//
// What it proves, for VERCEL_ENV=preview and VERCEL_ENV=production (and nothing elsewhere: local, CI, tests):
//   1. targets: the deployment names what it must connect to, in non-secret variables, and both URLs match:
//        TEND_EXPECT_DB               the database name
//        TEND_EXPECT_NEON_ENDPOINT    the Neon compute endpoint (ep-…), which identifies the Neon branch
//        TEND_EXPECT_RUNTIME_USER     the restricted login in DATABASE_URL
//        TEND_EXPECT_MIGRATE_USER     the schema owner in DATABASE_MIGRATE_URL
//        TEND_PRODUCTION_NEON_ENDPOINT  the production branch's endpoint. Required for a preview: neither URL, nor ANY other variable of the
//                                     deployment (POSTGRES_URL, PGHOST, DATABASE_URL_UNPOOLED from an integration, …), may contain it.
//   2. read-only database checks, each in a READ ONLY transaction, before anything is written:
//        the runtime login: who it is, which database, no superuser / BYPASSRLS / CREATEROLE / CREATEDB, not a member of a privileged role or
//          of the table owner, cannot create objects in schema public, cannot read the context-signing keys (tend_context_keys);
//        the owner login: who it is, which database, that it owns TEND's tables (when they exist), the schema version, and whether migrations
//          are pending. Pending migrations are refused unless this deployment carries TEND_ALLOW_MIGRATIONS=1 (an explicit approval).
//
// Output is names, versions and yes/no only: never a password, token, connection string or host. The endpoint ids are printed only as
// "matches TEND_EXPECT_NEON_ENDPOINT" (the expected value is the operator's own non-secret setting).
//
// Plain JavaScript on purpose: the build runs it with Node before anything is compiled, and the server imports the same file.

/** The migration count this release ships (db.ts MIGRATIONS.length; deploy-check.test.ts keeps them equal). */
export const SCHEMA_VERSION = 26;

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;
const ENDPOINT = /^ep-[a-z0-9]+(-[a-z0-9]+)*$/;
const LOCAL = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** Is this a deployment the check applies to? Vercel sets VERCEL=1 and VERCEL_ENV on every build and function. */
export function deployScope(env) {
  const vercelEnv = env.VERCEL_ENV ?? "";
  if (vercelEnv === "preview" || vercelEnv === "production") return { enforced: true, vercelEnv };
  // On Vercel without VERCEL_ENV the environment cannot be told apart: fail closed rather than guess.
  if (env.VERCEL === "1" && vercelEnv !== "development") return { enforced: true, vercelEnv: "unknown" };
  return { enforced: false, vercelEnv: vercelEnv || "none" };
}

const parse = (v) => { try { return new URL(v); } catch { return undefined; } };
/** The Neon endpoint id: the host's first label without the pooled suffix (ep-x-y-123-pooler.region.aws.neon.tech → ep-x-y-123). */
export const neonEndpoint = (u) => u.hostname.split(".")[0].replace(/-pooler$/, "");
const dbName = (u) => decodeURIComponent(u.pathname.replace(/^\//, ""));
const isNeon = (u) => /\.neon\.tech$/.test(u.hostname);

/**
 * @param {Record<string, string | undefined>} env
 * Pure, no network: the variables against the declared targets. Returns { enforced, problems, facts }; every string is safe to print.
 */
export function checkTargets(env) {
  const scope = deployScope(env);
  const problems = [], facts = [];
  if (!scope.enforced) return { ...scope, problems, targets: undefined, facts: [`not a Vercel preview or production deployment (VERCEL_ENV=${scope.vercelEnv}): deployment check not applied`] };
  if (scope.vercelEnv === "unknown") problems.push("VERCEL=1 but VERCEL_ENV is missing: cannot tell preview from production (turn on \"Automatically expose System Environment Variables\")");
  const preview = scope.vercelEnv !== "production"; // unknown is treated as the stricter preview rules
  const want = {
    db: env.TEND_EXPECT_DB ?? "", endpoint: env.TEND_EXPECT_NEON_ENDPOINT ?? "", runtimeUser: env.TEND_EXPECT_RUNTIME_USER ?? "",
    migrateUser: env.TEND_EXPECT_MIGRATE_USER ?? "", production: env.TEND_PRODUCTION_NEON_ENDPOINT ?? "",
  };
  const need = (ok, msg) => { if (!ok) problems.push(msg); };
  need(IDENT.test(want.db) || /^[A-Za-z0-9_-]{1,63}$/.test(want.db), "TEND_EXPECT_DB must be set to the database name this deployment must use");
  need(ENDPOINT.test(want.endpoint), "TEND_EXPECT_NEON_ENDPOINT must be set to the Neon endpoint id (ep-…) of the branch this deployment must use");
  need(IDENT.test(want.runtimeUser), "TEND_EXPECT_RUNTIME_USER must be set to the restricted runtime login (a lower-case identifier)");
  need(IDENT.test(want.migrateUser), "TEND_EXPECT_MIGRATE_USER must be set to the schema owner login (a lower-case identifier)");
  need(!want.runtimeUser || want.runtimeUser !== want.migrateUser, "TEND_EXPECT_RUNTIME_USER and TEND_EXPECT_MIGRATE_USER must be different logins");
  if (preview) {
    need(ENDPOINT.test(want.production), "TEND_PRODUCTION_NEON_ENDPOINT must be set (the production branch's endpoint id, ep-…) so this preview can prove it does not reach production");
    need(!want.production || want.endpoint !== want.production, "TEND_EXPECT_NEON_ENDPOINT is the production endpoint: a preview must use its own Neon branch");
  } else if (want.production) {
    need(want.endpoint === want.production, "TEND_EXPECT_NEON_ENDPOINT differs from TEND_PRODUCTION_NEON_ENDPOINT in a production deployment");
  }

  for (const [name, role, expectedUser] of [["DATABASE_URL", "runtime", want.runtimeUser], ["DATABASE_MIGRATE_URL", "owner", want.migrateUser]]) {
    const raw = env[name] ?? "";
    if (!raw) { problems.push(`${name} is not set`); continue; }
    if (/^\[?sensitive\]?$/i.test(raw.trim())) { problems.push(`${name} holds a placeholder, not a connection string`); continue; }
    const u = parse(raw);
    if (!u || !/^postgres(ql)?:$/.test(u.protocol)) { problems.push(`${name} is not a postgres:// or postgresql:// URL`); continue; }
    const user = decodeURIComponent(u.username);
    if (!user) problems.push(`${name} names no database user`);
    if (!u.password && !LOCAL.has(u.hostname)) problems.push(`${name} has no password in it`);
    if (expectedUser && user && user !== expectedUser) problems.push(`${name} logs in as "${user}", expected the ${role} login "${expectedUser}"`);
    if (want.db && dbName(u) !== want.db) problems.push(`${name} targets database "${dbName(u) || "none"}", expected "${want.db}"`);
    if (!isNeon(u)) problems.push(`${name} is not a Neon host (*.neon.tech), so its branch cannot be verified`);
    else {
      const ep = neonEndpoint(u);
      if (want.production && ep === want.production && preview) problems.push(`${name} is on the PRODUCTION Neon endpoint`);
      else if (want.endpoint && ep !== want.endpoint) problems.push(`${name} is not on TEND_EXPECT_NEON_ENDPOINT (another Neon branch)`);
    }
    if (!/^(require|verify-full|verify-ca)$/.test(u.searchParams.get("sslmode") ?? "") && !LOCAL.has(u.hostname)) problems.push(`${name} has no sslmode=require (or stronger)`);
    facts.push(`${name}: login ${user || "none"}, database ${dbName(u) || "none"}, ${isNeon(u) ? `Neon endpoint ${want.endpoint && neonEndpoint(u) === want.endpoint ? "matches TEND_EXPECT_NEON_ENDPOINT" : "does NOT match"}, ${/-pooler$/.test(u.hostname.split(".")[0]) ? "pooled" : "direct"}` : "not Neon"}`);
  }
  // Nothing in this deployment may lead to production: an integration (Neon's, Vercel Postgres) adds its own variables next to ours.
  if (preview && ENDPOINT.test(want.production)) {
    const leaks = Object.entries(env).filter(([k, v]) => k !== "TEND_PRODUCTION_NEON_ENDPOINT" && typeof v === "string" && v.includes(want.production)).map(([k]) => k);
    for (const k of leaks) if (k !== "DATABASE_URL" && k !== "DATABASE_MIGRATE_URL") problems.push(`${k} refers to the production Neon endpoint: remove it from this preview's variables`);
    facts.push(`production endpoint referenced by ${leaks.length ? leaks.join(", ") : "no variable"} of this deployment`);
  }
  return { ...scope, problems, facts, targets: want };
}

/** Read-only probe of the runtime login. `all(sql)` runs one statement inside a READ ONLY transaction and returns its rows. */
export async function probeRuntime(all, targets) {
  const [r] = await all(`SELECT session_user AS login, current_user AS who, current_database() AS db,
      r.rolsuper AS sup, r.rolbypassrls AS bypass, r.rolcreaterole AS createrole, r.rolcreatedb AS createdb, r.rolcanlogin AS canlogin,
      coalesce((SELECT string_agg(p.rolname, ',' ORDER BY p.rolname) FROM pg_roles p
                 WHERE p.oid <> r.oid AND (p.rolsuper OR p.rolbypassrls OR p.rolcreaterole OR p.rolcreatedb) AND pg_has_role(r.oid, p.oid, 'MEMBER')), '') AS privileged,
      EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND pg_has_role(r.oid, c.relowner, 'MEMBER')) AS owns,
      has_schema_privilege(r.oid, 'public', 'CREATE') AS createpublic,
      to_regclass('public.agents') IS NOT NULL AS schema,
      CASE WHEN to_regclass('public.tend_context_keys') IS NULL THEN NULL
           ELSE has_table_privilege(r.oid, 'public.tend_context_keys', 'SELECT') OR has_table_privilege(r.oid, 'public.tend_context_keys', 'INSERT')
             OR has_table_privilege(r.oid, 'public.tend_context_keys', 'UPDATE') OR has_table_privilege(r.oid, 'public.tend_context_keys', 'DELETE') END AS keys,
      current_setting('transaction_read_only') AS ro
    FROM pg_roles r WHERE r.rolname = session_user`);
  const problems = [], facts = [];
  if (!r) return { problems: ["the runtime login could not read its own role"], facts };
  if (r.ro !== "on") problems.push("internal: the runtime probe did not run read-only");
  if (targets?.runtimeUser && r.login !== targets.runtimeUser) problems.push(`DATABASE_URL connected as "${r.login}", expected "${targets.runtimeUser}"`);
  if (targets?.db && r.db !== targets.db) problems.push(`DATABASE_URL connected to database "${r.db}", expected "${targets.db}"`);
  if (r.sup) problems.push(`the runtime login ${r.login} is a superuser`);
  if (r.bypass) problems.push(`the runtime login ${r.login} has BYPASSRLS`);
  if (r.createrole) problems.push(`the runtime login ${r.login} has CREATEROLE`);
  if (r.createdb) problems.push(`the runtime login ${r.login} has CREATEDB`);
  if (r.privileged) problems.push(`the runtime login ${r.login} is a member of privileged role(s) ${r.privileged} (a role made in the Neon Console is a member of neon_superuser: create it with SQL instead)`);
  if (r.owns) problems.push(`the runtime login ${r.login} owns TEND's tables, or is a member of their owner`);
  if (r.createpublic) problems.push(`the runtime login ${r.login} may create objects in schema public (it would own them)`);
  if (r.keys === true) problems.push(`the runtime login ${r.login} has privileges on tend_context_keys (the context-signing keys must be readable by the owner only)`);
  facts.push(`runtime login ${r.login}: database ${r.db}, superuser ${r.sup}, BYPASSRLS ${r.bypass}, CREATEROLE ${r.createrole}, CREATEDB ${r.createdb}, privileged memberships ${r.privileged || "none"}, owns tables ${r.owns}, may create in public ${r.createpublic}, access to tend_context_keys ${r.keys === null ? "n/a (no schema yet)" : r.keys}`);
  return { problems, facts, schema: !!r.schema };
}

/** Read-only probe of the owner login and of the schema state. Same `all` contract as probeRuntime. */
export async function probeOwner(all, targets, { allowMigrations = false, expectedVersion = SCHEMA_VERSION } = {}) {
  const [r] = await all(`SELECT session_user AS login, current_database() AS db, current_setting('transaction_read_only') AS ro,
      to_regclass('public.schema_migrations') IS NOT NULL AS history, to_regclass('public.meta') IS NOT NULL AS meta,
      (SELECT pg_has_role(session_user, c.relowner, 'MEMBER') FROM pg_class c WHERE c.oid = to_regclass('public.agents')) AS owns`);
  const problems = [], facts = [];
  if (!r) return { problems: ["the owner login could not be read"], facts };
  if (r.ro !== "on") problems.push("internal: the owner probe did not run read-only");
  if (targets?.migrateUser && r.login !== targets.migrateUser) problems.push(`DATABASE_MIGRATE_URL connected as "${r.login}", expected "${targets.migrateUser}"`);
  if (targets?.db && r.db !== targets.db) problems.push(`DATABASE_MIGRATE_URL connected to database "${r.db}", expected "${targets.db}"`);
  if (r.owns === false) problems.push(`the owner login ${r.login} does not own TEND's tables: wrong login, or a database set up by someone else`);
  let applied = [];
  if (r.history) applied = (await all("SELECT version FROM schema_migrations ORDER BY version")).map((x) => Number(x.version));
  const have = new Set(applied);
  const missing = Array.from({ length: expectedVersion }, (_, i) => i + 1).filter((v) => !have.has(v));
  if (!applied.length && r.meta) problems.push("database_not_baselined: TEND's tables exist but schema_migrations records no migration; nothing will be migrated over them");
  else if (missing.length && !allowMigrations)
    problems.push(`${missing.length} migration(s) would run (version${missing.length > 1 ? "s" : ""} ${missing.length > 3 ? `${missing[0]}–${missing.at(-1)}` : missing.join(", ")}) and this deployment has no approval: set TEND_ALLOW_MIGRATIONS=1 for it to allow them`);
  const version = applied.length ? Math.max(...applied) : 0;
  facts.push(`owner login ${r.login}: database ${r.db}, owns tables ${r.owns === null ? "n/a (no schema yet)" : r.owns}, schema version ${version}${applied.length ? "" : " (empty database)"}, release expects ${expectedVersion}, pending migrations ${missing.length}${missing.length ? (allowMigrations ? " (approved: TEND_ALLOW_MIGRATIONS=1)" : " (not approved)") : ""}`);
  return { problems, facts, version, pending: missing.length };
}
