# Database roles and what the database does (and does not) enforce

## What is actually in this repository

- **Tenant isolation is enforced by the application, not by the database.** Every route that takes an id checks it against the caller's
  workspace first (`agentInWorkspace`, `reviewInWorkspace`, `centralInWorkspace` in `src/server/repo.ts`), and every listing is filtered by
  workspace. There is **no PostgreSQL row-level security and no tenant context** in this code base. A missed check, or an SQL injection,
  would expose every tenant. The tests that guard the checks are `redteam/live/tenant-matrix.mjs` (every route × every identity × every
  object of another tenant) and the negative controls in `redteam/mutation-controls.mjs --routes` (removing a check must make the matrix fail).
- Nothing here uses a `TEND_CONTEXT_KEY` or a tenant-scoped grant. If you have a branch that does, it is not this one.

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

## If you want database-enforced tenant isolation

That is a design, not a setting: add `workspace_id` to every table that lacks it (`events`, `reviews`, `authorizations`, … are reached through
`agents`), enable RLS with policies on a per-transaction `set_config('tend.workspace', …)` that the application sets only after authenticating, run
the application as a role without `BYPASSRLS`, and give the few cross-tenant jobs (admin listing, push queue, audit verification) their own role.
None of that exists here; it needs its own review, especially around connection pooling (`SET LOCAL` inside the transaction, never session
`SET`) and the global advisory lock every write takes.
