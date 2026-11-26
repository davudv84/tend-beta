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

/** What migrations 1–26 create in schema public (deploy-check.test.ts keeps these lists equal to db.ts MIGRATIONS). */
export const TEND_TABLES = ["meta", "agents", "events", "reviews", "asks", "rate_limits", "authorizations", "verification_runs", "operator_sessions", "auth_events",
  "central_policies", "workspaces", "users", "user_tokens", "onboarding", "notifications", "push_subscriptions", "notification_prefs", "tend_context_keys", "user_mfa", "invitations"];
export const TEND_FUNCTIONS = ["events_append_only", "events_chain", "meta_protect_chain", "tend_ws_visible", "tend_agent_visible", "tend_user_visible", "tend_ctx_valid",
  "tend_ctx_workspace", "tend_ctx_system"];
/** The tables row-level security covers (db.ts RLS_TABLES; deploy-check.test.ts keeps them equal). */
export const RLS_TABLES = ["workspaces", "agents", "central_policies", "users", "notifications", "events", "reviews", "asks", "authorizations", "verification_runs",
  "operator_sessions", "auth_events", "user_tokens", "onboarding", "push_subscriptions", "notification_prefs", "user_mfa", "invitations"];
/** The append-only audit tables: the runtime login may add rows, never change, delete or truncate them. */
export const AUDIT_TABLES = ["events", "auth_events", "verification_runs"];
/** The shape of every TEND policy (the same rule as db.ts enableIsolation): system context, or the row's tenant; WITH CHECK equal to USING. */
export const POLICY_SHAPE = /^\(\( SELECT tend_ctx_system\(\) AS tend_ctx_system\) OR /;
const lit = (xs) => `ARRAY[${xs.map((x) => `'${String(x).replace(/'/g, "''")}'`).join(", ")}]`;

/** The built-in functions the migrations' SQL and the start-up call (EXECUTE is PUBLIC by default; a hardened database could revoke it). */
export const BUILTINS = ["pg_catalog.sha256(bytea)", "pg_catalog.convert_to(text,name)", "pg_catalog.encode(bytea,text)", "pg_catalog.current_setting(text,boolean)",
  "pg_catalog.set_config(text,text,boolean)", "pg_catalog.pg_advisory_xact_lock(bigint)"];

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
    if (want.db && dbName(u) !== want.db) problems.push(`${name} targets database "${dbName(u) || "none"}", expected "${want.db}"${dbName(u).trim() === want.db ? " (the name has spaces around it: remove them after the last / of the URL)" : ""}`);
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
  if (r.schema) {
    const [g] = await all(`SELECT
        coalesce((SELECT string_agg(t, ', ') FROM unnest(${lit(RLS_TABLES)}) AS t WHERE to_regclass('public.' || t) IS NOT NULL
                   AND NOT (has_table_privilege(session_user, 'public.' || t, 'SELECT') AND has_table_privilege(session_user, 'public.' || t, 'INSERT'))), '') AS noaccess,
        coalesce((SELECT string_agg(t, ', ') FROM unnest(${lit(AUDIT_TABLES)}) AS t WHERE has_table_privilege(session_user, 'public.' || t, 'UPDATE')
                   OR has_table_privilege(session_user, 'public.' || t, 'DELETE') OR has_table_privilege(session_user, 'public.' || t, 'TRUNCATE')), '') AS auditwrite,
        has_table_privilege(session_user, 'public.schema_migrations', 'INSERT') OR has_table_privilege(session_user, 'public.schema_migrations', 'UPDATE')
          OR has_table_privilege(session_user, 'public.schema_migrations', 'DELETE') AS historywrite,
        has_database_privilege(session_user, current_database(), 'TEMPORARY') AS temp`);
    if (g.auditwrite) problems.push(`the runtime login ${r.login} may change, delete or truncate the audit log tables ${g.auditwrite}`);
    if (g.historywrite) problems.push(`the runtime login ${r.login} may write schema_migrations`);
    facts.push(`runtime rights: SELECT+INSERT on the ${RLS_TABLES.length} tenant tables ${g.noaccess ? `MISSING on ${g.noaccess} (granted at the next start)` : "yes"}, may change audit log ${g.auditwrite || "no"}, may write schema_migrations ${g.historywrite}, TEMPORARY ${g.temp}${g.temp ? " (revoked at the next start)" : ""}`);
  }
  facts.push(`runtime login ${r.login}: database ${r.db}, superuser ${r.sup}, BYPASSRLS ${r.bypass}, CREATEROLE ${r.createrole}, CREATEDB ${r.createdb}, privileged memberships ${r.privileged || "none"}, owns tables ${r.owns}, may create in public ${r.createpublic}, access to tend_context_keys ${r.keys === null ? "n/a (no schema yet)" : r.keys}`);
  return { problems, facts, schema: !!r.schema };
}

/** Read-only probe of the owner login and of the schema state. Same `all` contract as probeRuntime. */
export async function probeOwner(all, targets, { allowMigrations = false, expectedVersion = SCHEMA_VERSION, contextKid = "" } = {}) {
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
  // What the migrations and the start-up need from the owner, read from the catalogs (nothing is tried): own the database (start-up runs
  // REVOKE/GRANT TEMPORARY ON DATABASE), create in public (tables, indexes, functions, triggers, policies), grant USAGE on public to the
  // runtime login, use the languages plpgsql and sql, execute the built-ins, PostgreSQL 11+ (sha256). And nothing already in public may
  // collide with what the migrations create: CREATE TABLE would fail, CREATE OR REPLACE FUNCTION would replace someone else's function.
  const [c] = await all(`SELECT pg_get_userbyid(d.datdba) AS dbowner, pg_has_role(session_user, d.datdba, 'MEMBER') AS ownsdb,
      (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'public') AS schemaowner,
      has_schema_privilege(session_user, 'public', 'CREATE') AS createpublic, has_schema_privilege(session_user, 'public', 'USAGE') AS usagepublic,
      has_schema_privilege(session_user, 'public', 'USAGE WITH GRANT OPTION')
        OR pg_has_role(session_user, (SELECT nspowner FROM pg_namespace WHERE nspname = 'public'), 'MEMBER') AS grantusage,
      has_language_privilege(session_user, 'plpgsql', 'USAGE') AS plpgsql, has_language_privilege(session_user, 'sql', 'USAGE') AS sqllang,
      coalesce((SELECT string_agg(f, ', ') FROM unnest(${lit(BUILTINS)}) AS f WHERE to_regprocedure(f) IS NULL OR NOT has_function_privilege(session_user, to_regprocedure(f), 'EXECUTE')), '') AS nofunctions,
      current_setting('server_version_num')::int AS version,
      coalesce((SELECT string_agg(c.relname, ', ' ORDER BY c.relname) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
                 AND c.relname = ANY(${lit(TEND_TABLES)}) AND NOT pg_has_role(session_user, c.relowner, 'MEMBER')), '') AS foreigntables,
      coalesce((SELECT string_agg(DISTINCT p.proname, ', ') FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                 AND p.proname = ANY(${lit(TEND_FUNCTIONS)}) AND NOT pg_has_role(session_user, p.proowner, 'MEMBER')), '') AS foreignfunctions,
      coalesce((SELECT string_agg(c.relname, ', ' ORDER BY c.relname) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
                 AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f') AND c.relname = ANY(${lit(TEND_TABLES)})), '') AS existing
    FROM pg_database d WHERE d.datname = current_database()`);
  if (c) {
    if (!c.ownsdb) problems.push(`the owner login ${r.login} does not own database ${r.db} (its owner is ${c.dbowner}): start-up must REVOKE/GRANT TEMPORARY ON DATABASE, which only the owner may do`);
    if (!c.createpublic) problems.push(`the owner login ${r.login} may not CREATE in schema public (owned by ${c.schemaowner}): the migrations create their tables and functions there`);
    if (!c.usagepublic) problems.push(`the owner login ${r.login} has no USAGE on schema public`);
    if (!c.grantusage) problems.push(`the owner login ${r.login} may not grant USAGE on schema public to the runtime login (not the schema owner ${c.schemaowner}, no grant option)`);
    if (!c.plpgsql || !c.sqllang) problems.push(`the owner login ${r.login} may not use the function language${!c.plpgsql && !c.sqllang ? "s plpgsql and sql" : c.plpgsql ? " sql" : " plpgsql"}`);
    if (c.nofunctions) problems.push(`the owner login ${r.login} may not execute, or the server lacks: ${c.nofunctions}`);
    if (Number(c.version) < 110000) problems.push(`PostgreSQL ${c.version} is too old: the migrations need 11 or later (sha256)`);
    if (c.foreigntables) problems.push(`schema public already has ${c.foreigntables}, owned by another role: the migrations would fail on them or leave them out of TEND's control`);
    if (c.foreignfunctions) problems.push(`schema public already has function(s) ${c.foreignfunctions} owned by another role: CREATE OR REPLACE would fail or the start-up would refuse them`);
    if (!applied.length && !r.meta && c.existing) problems.push(`schema public has no migration history but already holds ${c.existing}: CREATE TABLE in migration 1 would fail; use an empty database`);
    facts.push(`owner rights: owns database ${c.ownsdb} (owner ${c.dbowner}), CREATE in public ${c.createpublic} (schema owner ${c.schemaowner}), may grant USAGE on public ${c.grantusage}, languages plpgsql ${c.plpgsql} / sql ${c.sqllang}, built-ins ${c.nofunctions ? `missing ${c.nofunctions}` : "all executable"}, PostgreSQL ${c.version}, conflicting objects ${c.foreigntables || c.foreignfunctions || (!applied.length && c.existing) || "none"}`);
  }
  // Only for the real owner: another login cannot read tend_context_keys (that is the point), and was already reported above.
  if (applied.length && r.owns === true) {
    const [o] = await all(`SELECT
        coalesce((SELECT string_agg(c.relname, ', ' ORDER BY c.relname) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
                   AND NOT pg_has_role(session_user, c.relowner, 'MEMBER')), '') AS notowned,
        (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p'))::int AS tables,
        coalesce((SELECT string_agg(t, ', ') FROM unnest(${lit(RLS_TABLES)}) AS t WHERE NOT coalesce((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass('public.' || t)), false)), '') AS norls,
        coalesce((SELECT string_agg(t, ', ') FROM unnest(${lit(RLS_TABLES)}) AS t WHERE NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = t)), '') AS nopolicy,
        (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = ANY(${lit(RLS_TABLES)}))::int AS policies,
        (SELECT count(*) FROM tend_context_keys)::int AS keys,
        ${contextKid && /^[0-9a-f]{16}$/.test(contextKid) ? `EXISTS (SELECT 1 FROM tend_context_keys WHERE kid = '${contextKid}')` : "NULL::boolean"} AS ourkey`);
    const pol = await all(`SELECT tablename AS t, policyname AS n, coalesce(qual, '') AS q, coalesce(with_check, '') AS w FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY(${lit(RLS_TABLES)})`);
    const loose = pol.filter((p) => !(POLICY_SHAPE.test(p.q) && p.w === p.q)).map((p) => `${p.t}.${p.n}`);
    if (o.notowned) problems.push(`tables in public not owned by ${r.login}: ${o.notowned}`);
    if (o.norls) problems.push(`row-level security is off on: ${o.norls}`);
    if (o.nopolicy) problems.push(`tenant tables without a policy: ${o.nopolicy}`);
    if (loose.length) problems.push(`policies that are not TEND's tenant rule: ${loose.join(", ")}`);
    facts.push(`schema: ${o.tables} tables, all owned by ${r.login} ${!o.notowned}, RLS on ${RLS_TABLES.length - (o.norls ? o.norls.split(", ").length : 0)}/${RLS_TABLES.length} tenant tables, ${o.policies} policies (all TEND's tenant rule ${!loose.length}), context keys ${o.keys}${o.ourkey === null ? "" : `, this deployment's key installed ${o.ourkey}${o.ourkey ? "" : " (installed at the next start)"}`}`);
  }
  const version = applied.length ? Math.max(...applied) : 0;
  facts.push(`owner login ${r.login}: database ${r.db}, owns tables ${r.owns === null ? "n/a (no schema yet)" : r.owns}, schema version ${version}${applied.length ? "" : " (empty database)"}, release expects ${expectedVersion}, pending migrations ${missing.length}${missing.length ? (allowMigrations ? " (approved: TEND_ALLOW_MIGRATIONS=1)" : " (not approved)") : ""}`);
  return { problems, facts, version, pending: missing.length };
}

/**
 * Tenant isolation, as the runtime login, read only: with the context keys installed, a forged tenant context (plain settings, or a
 * signature for another transaction) must be refused by tend_ctx_valid(), and a context signed with this deployment's TEND_CONTEXT_KEY for
 * THIS transaction must be accepted. Only transaction-local settings change, inside a READ ONLY transaction that is rolled back. `sign` is
 * (workspace, system, nonce) => { kid, mac } as db.ts contextSignature computes it; the key itself never leaves the caller.
 */
export async function probeIsolation(all, sign) {
  const problems = [], facts = [];
  const tx = "pg_backend_pid()::text || '.' || (extract(epoch FROM now()) * 1000000)::bigint::text"; // db.ts TX_BINDING
  const ctx = (ws, sys, nonce, kid, mac) => all(`SELECT set_config('tend.workspace', '${ws}', true), set_config('tend.system', '${sys}', true),
      set_config('tend.ctx_nonce', '${nonce}', true), set_config('tend.ctx_kid', '${kid}', true), set_config('tend.ctx_mac', '${mac}', true)`);
  const state = async () => (await all("SELECT tend_ctx_valid() AS valid, tend_ctx_system() AS sys, tend_ctx_workspace() AS ws, (SELECT count(*) FROM agents)::int AS agents"))[0];
  const [{ nonce }] = await all(`SELECT ${tx} AS nonce`);
  if (!/^[0-9]+\.[0-9]+$/.test(nonce)) return { problems: ["internal: could not read the transaction binding"], facts };
  // 1. forged: system flag and a workspace, no signature
  await ctx("probe_ws", "on", "", "", "");
  const forged = await state();
  // 2. forged: a signature for this workspace, but made for another transaction
  const stale = sign("probe_ws", "", "1.1");
  await ctx("probe_ws", "", nonce, stale.kid, stale.mac);
  const replay = await state();
  // 3. signed for this transaction with this deployment's key
  const good = sign("probe_ws", "", nonce);
  await ctx("probe_ws", "", nonce, good.kid, good.mac);
  const signed = await state();
  if (forged.valid || forged.sys || forged.ws) problems.push("an unsigned tenant context was accepted (no context key installed, or tend_ctx_valid() replaced): tenant isolation would not hold");
  if (replay.valid || replay.ws) problems.push("a context signed for another transaction was accepted: signatures can be replayed");
  if (!signed.valid || signed.ws !== "probe_ws" || signed.sys) problems.push("a context signed with this deployment's TEND_CONTEXT_KEY was refused: the installed key is not this deployment's (every request would see nothing)");
  facts.push(`tenant isolation (as the runtime login, read only): unsigned context refused ${!forged.valid && !forged.sys && !forged.ws}, replayed signature refused ${!replay.valid && !replay.ws}, correctly signed context accepted ${!!signed.valid && signed.ws === "probe_ws"} (workspace only, no system rights ${!signed.sys})`);
  return { problems, facts };
}
