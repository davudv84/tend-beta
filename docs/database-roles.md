# Database roles and what the database does (and does not) enforce

## Tenant isolation: two layers

1. **The application** checks every id against the caller's workspace (`agentInWorkspace`, `reviewInWorkspace`, `centralInWorkspace` in
   `src/server/repo.ts`) and filters every listing.
2. **The database** (PostgreSQL, on by default in production: `TEND_DB_ISOLATION`) enforces it again with row-level security
   (migration 18 in `src/server/db.ts`), so a missing check or an unfiltered query in the application cannot cross tenants.

How the database layer works:

- Every tenant table has a policy (`USING` and `WITH CHECK`): `workspaces`, `agents`, `central_policies`, `users`, `notifications` by their
  workspace; `events`, `reviews`, `asks`, `authorizations`, `verification_runs` through their agent; `operator_sessions`, `auth_events`,
  `user_tokens`, `onboarding`, `push_subscriptions`, `notification_prefs` through their user. `RLS_TABLES` in `db.ts` lists them.
- The tenant comes from **authentication on the server** (`src/server/db-context.ts`): `requireOperator` binds the session's workspace,
  `authAgent` the key's agent's workspace. A request starts with no tenant, which shows nothing tenant-scoped (fail closed). Binding a second,
  different workspace in one request is refused.
- Every transaction starts with `SET LOCAL ROLE <runtime role>` and `set_config('tend.workspace', …, true)`: transaction-scoped, so nothing
  survives on a pooled connection (safe with PgBouncer transaction pooling, which Neon uses). A statement outside a transaction becomes a
  transaction of its own.
- The runtime role: when the application logs in as the schema owner (one `DATABASE_URL`, Vercel's Neon integration), a `NOLOGIN` role
  (`TEND_DB_RUNTIME_ROLE`, default `tend_runtime`) is created with `runtimeGrantsSql`'s privileges and the login role is granted membership.
  With `DATABASE_MIGRATE_URL` the restricted login is used as is.
- Start-up self-test (`enableIsolation`): the effective role must not be a superuser, must not have `BYPASSRLS`, must not own or be a member
  of the role that owns a table, every table in `RLS_TABLES` must have RLS on with exactly TEND's policy (no extra permissive policy), and a
  configured `TEND_CONTEXT_KEY` must be one the database holds. Otherwise the server does not start. `TEND_DB_ISOLATION=off` is the only way to run without it, and
  production logs a warning then.
- The explicit cross-tenant paths run with `tend.system = on` and are all marked `asSystem` (`grep -rn asSystem src`):
  - looking up a session or an agent key before anyone is known;
  - sign-up, sign-in and password reset;
  - the platform admin's routes;
  - the push queue;
  - moving a browser's push subscription to the account that subscribed it last.
  The built-in demo's maintenance uses `asOwner` (no role switch).

**Signed tenant context** (migration 20, `TEND_CONTEXT_KEY`): the server also sets a fresh nonce and a MAC,
`sha256(key || sha256(workspace | system | nonce))`, per transaction. The policies trust `tend.workspace` and `tend.system` only when
`tend_ctx_valid()`, a `SECURITY DEFINER` function, recomputes that MAC with a key from `tend_context_keys`, a table only the owner can read.
Start-up refuses a key the database does not hold. With no key installed the check is off (development, older deployments). Rotation:
`docs/operations.md`. Migration 21 rewrote the policies so the context is checked once per statement (an initplan) rather than once per row:
on 12,000 to 20,000 events, tenant queries went from 242 to 601 ms down to 17 to 25 ms (`redteam/bench/rls-bench.mjs`).

**What the database layer does and does NOT stop**, each shown by a test in `src/server/rls.test.ts`:

- **Restricted login** (`DATABASE_MIGRATE_URL` for the owner, `DATABASE_URL` for a role that is not the owner) **with a context key**:
  injected SQL that sets `tend.system = on` or another tenant's `tend.workspace` sees nothing, because it cannot compute the MAC
  (RLS-9, with a negative control: without a key installed the same SQL reads everything). It can still replay the settings the server already
  set for *its own* transaction, so it acts as the current tenant, and use what the runtime role's privileges allow there.
- **Owner login (the default single-URL deployment):** SQL running in the application's session can `RESET ROLE` back to the owner (RLS-5),
  which bypasses RLS and can read the key table. The signed context does not help here.
- **No context key:** such SQL can `set_config('tend.system', 'on', true)` (RLS-6). A setting is not a privilege.
- So in the default single-URL deployment RLS stops the application's **own mistakes**, not **SQL injection**. Against injection, use a
  restricted login plus `TEND_CONTEXT_KEY`; parameterised queries are the first line either way.

**Not covered by RLS, on purpose:**

- `rate_limits`: counters keyed by hashes and addresses.
- `meta`: demo state; the audit-chain boundary row has its own trigger.
- `schema_migrations`: read-only to the runtime role.
- The embedded database (PGlite, local development and tests) runs as the owner, so RLS does not apply to it.

**Evidence** (all on real PostgreSQL 16):

- `src/server/rls.test.ts` RLS-1…9:
  - self-test;
  - cross-tenant reads and writes through code with no workspace check;
  - fail closed;
  - no pooled-connection contamination over 200 interleaved requests;
  - negative control (RLS off on one table, then the leak appears and start-up refuses);
  - the gaps above;
  - the audit hash chain under RLS (RLS-7), the stricter self-test (RLS-8), the signed context (RLS-9).
- The e2e suites with `TEND_E2E_DATABASE_URL`.
- `node redteam/mutation-controls.mjs --routes` with `TEND_E2E_DATABASE_URL`: with the workspace check removed from the reviews route or the
  agent-keys route, the 9,108-request tenant matrix still holds.

## The audit log and the application's database role

`events`, `auth_events` and `verification_runs` are append-only by trigger. The trigger is switched off for a transaction by
`SELECT set_config('tend.maintenance', 'on', true)`, which **any** database session may run. So the trigger stops application bugs, not an
attacker who can execute SQL in a role that holds `UPDATE`/`DELETE` on those tables. The protection that does hold against the application
role is **privilege**: give the application a role that has no `UPDATE`, `DELETE` or `TRUNCATE` on them (and cannot alter the schema).

```bash
# once per database, as the schema owner; the role must exist: NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS
node scripts/db-grants.mjs tend_app | psql "$OWNER_DATABASE_URL"
```

`runtimeGrantsSql()` (`src/server/db.ts`) grants `SELECT, INSERT, UPDATE, DELETE` on all tables and `USAGE` on sequences, then revokes
`UPDATE, DELETE, TRUNCATE` on the three log tables, `DELETE, TRUNCATE` on `agents`, `users` and `workspaces`, all writes on `schema_migrations`, and
`CREATE` on the schema. **`agents` matters:** `events` and `verification_runs` are `ON DELETE CASCADE` children of it, and a cascade runs with the
owner's privileges, so a role that could delete an agent (with the maintenance flag raised) could erase that agent's whole history without any
privilege on the log tables. An independent review of the first version of this grant found exactly that; PV-7 reproduces it (it fails when the
revoke is removed) and checks the fix. Migration 17 also makes the hash-chain boundary row in `meta` (`events.chain.v2_after`) immutable by trigger.
`src/server/postgres-verify.test.ts` (PV-5) runs the application's flows as such a role on real PostgreSQL and checks that DELETE/UPDATE/TRUNCATE
of the logs (with the maintenance flag raised), `DROP TRIGGER`, `ALTER TABLE`, `CREATE TABLE` and rewriting `schema_migrations` all fail with
`42501`. The same test shows the contrast: the owner role can erase events with the flag.

## Separate migration and runtime roles (optional)

By default one role migrates (at every cold start) and serves requests. To keep schema-changing rights out of the running application:

```
DATABASE_MIGRATE_URL=postgres://owner…   # used only at start-up, on a short-lived connection
DATABASE_URL=postgres://tend_app…        # the pool the application uses
```

At start-up the owner migrates, then the runtime role must find every migration applied (`assertSchemaCurrent`); otherwise the start fails and no
request is served. Tested on real PostgreSQL (PV-6) and for the failure paths without a database (`src/server/db-startup.test.ts`: an unreachable
`DATABASE_URL`, Vercel with no database, a half-configured split, an outdated schema). A start with a database URL never falls back to the
embedded database.

Limits of this, stated plainly:

- **PostgreSQL 15 or newer.** Before 15, `PUBLIC` holds `CREATE` on schema `public`, so revoking it from one role does not stop that role creating
  objects. On 14 or older also run `REVOKE CREATE ON SCHEMA public FROM PUBLIC` (it affects every role in the database).
- **Grants cover existing tables only.** After a release that adds a table, re-run `scripts/db-grants.mjs`; until then the application fails on the
  new table (the start-up check reads migration versions, not privileges), and a new *log* table would lack its revokes. Do not rely on
  `ALTER DEFAULT PRIVILEGES` for this: it would grant the log tables' write privileges back.
- **Denial of service is not prevented.** Any role that can run SQL can take the advisory locks every write takes (`pg_advisory_lock(7311)`) and
  stall the whole service. Privileges cannot stop that.
- The `meta` table stays writable by the role (the optional demo account keeps state there); only the chain-boundary row is protected.
- A restricted role is only as good as its use: the application must connect as it (`DATABASE_URL`), the owner only through
  `DATABASE_MIGRATE_URL`. If both URLs are the same, start-up logs a warning and nothing is split.

Not covered: the demo's retention (`allowEventRemoval`) needs `DELETE` on `events` and does not run under the restricted role; a production
database has no demo. A database *owner* can always drop the triggers; keep the audit checkpoint (`npm run tend -- audit-verify`) outside TEND.

## Possible next steps for the database layer

- Default to a restricted login on Vercel/Neon (today it needs `DATABASE_MIGRATE_URL` set by hand), so the signed context protects the default deployment.
- A `workspace_id` column on the agent-linked tables, so policies don't need the `agents` subquery.
- Separate roles for the cross-tenant jobs instead of a setting.
- Per-tenant advisory locks instead of one global write lock.
