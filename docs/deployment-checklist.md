# Isolated preview deployment checklist (Vercel + Neon)

For a **preview** first, on a separate Neon branch with synthetic data, never the production database. Nothing here has been run against
Vercel or Neon from this repository's tests: every item below is a step for the operator, with how to check it.

> **Breaking change for the current deployment:** since this round a production server **refuses to start** with a single owner
> `DATABASE_URL` (Vercel's default Neon integration) unless the restricted login below is set up, or `TEND_DB_ALLOW_OWNER_LOGIN=1` is set
> explicitly (logged at every start; RLS then does not stop SQL injection). Do steps 1–3 before the next production deploy.

## 1. Database identities (Neon SQL editor, as `neondb_owner`, on the preview branch)

```sql
CREATE ROLE tend_app LOGIN PASSWORD '<generated, 32+ chars>' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT CONNECT ON DATABASE neondb TO tend_app;
```
Nothing else: TEND's start-up (as the owner) migrates, grants `tend_app` exactly its privileges and revokes `TEMPORARY` from `PUBLIC`.

## 2. Environment variables (Vercel → Project → Settings → Environment Variables, scope "Preview", all marked Sensitive)

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | the **pooled** endpoint's URL, user `tend_app` with its password, `?sslmode=require` |
| `DATABASE_MIGRATE_URL` | the **direct** (unpooled) endpoint's URL, user `neondb_owner`, `?sslmode=require` |
| `TEND_CONTEXT_KEY` | `openssl rand -base64 48` |
| `TEND_MFA_KEY` | `openssl rand -base64 48` (a different value) |
| `TEND_ADMIN_TOKEN` | `openssl rand -hex 32` (or `TEND_ADMIN=0`) |
| `TEND_APP_URL` | `https://<preview host>` |
| `TEND_ALERT_WEBHOOK_URL` | an HTTPS receiver you control (optional but recommended) |

Deployment targets (not secret, so **not** Sensitive; the deployment check compares the real URLs with them):

| Variable | Value |
| --- | --- |
| `TEND_EXPECT_DB` | the database name, e.g. `tend_preview_fresh` |
| `TEND_EXPECT_NEON_ENDPOINT` | the preview branch's endpoint id: Neon → Branches → the branch → Computes, `ep-…` |
| `TEND_EXPECT_RUNTIME_USER` | the restricted login in `DATABASE_URL`, e.g. `tend_runtime` |
| `TEND_EXPECT_MIGRATE_USER` | the owner in `DATABASE_MIGRATE_URL`, e.g. `neondb_owner` |
| `TEND_PRODUCTION_NEON_ENDPOINT` | the **production** branch's endpoint id. A preview fails if any of its variables contains it |
| `TEND_ALLOW_MIGRATIONS` | leave unset. Set `1` only to approve the migrations the check reports as pending, then remove it |

For Production the same `TEND_EXPECT_*` variables are required, with the production values (`TEND_PRODUCTION_NEON_ENDPOINT` optional there,
equal to `TEND_EXPECT_NEON_ENDPOINT` if set).

Remove the integration's `POSTGRES_URL*` and `PG*` variables from the preview scope: the deployment check refuses any that points at the
production endpoint (TEND reads `POSTGRES_URL` only when `DATABASE_URL` is unset).

## 3. Deployment check (inside Vercel, values never printed)

`vercel env pull` writes a placeholder for every Sensitive variable, so a local check cannot validate the real connection strings. The check
therefore runs **inside the deployment**, where the real values are: `npm run build` starts with `node scripts/deploy-check.mjs`, and the server
repeats it at every start before its first write (`src/server/deploy-check.mjs`). On a Vercel preview or production it:

1. compares both URLs with the targets above (login, database, Neon endpoint, password present, `sslmode`), and for a preview scans every variable
   for the production endpoint. Nothing connects until this passes;
2. connects with each URL in a `READ ONLY` transaction (rolled back) and checks the runtime login (no superuser, BYPASSRLS, CREATEROLE, CREATEDB,
   no privileged or owner membership, cannot create in `public`, no access to `tend_context_keys`) and the owner (right login and database, owns
   TEND's tables, schema version);
3. refuses pending migrations unless `TEND_ALLOW_MIGRATIONS=1` is set for the deployment.

Any problem fails the build ("stopping before deployment. Nothing was written to any database.") and the build log lists each one by variable
name. The log shows logins, database names, versions and yes/no only.

The local preflight (`node scripts/check-production-config.mjs <file>`) still checks the non-secret rules on a file you build from your own copies
of the values (`umask 077`, delete it afterwards); it cannot replace the deployment check.

Also in the Preview scope: `TEND_DEMO=0`. The demo (on by default) seeds synthetic agents on every dashboard poll and its retention needs DELETE rights the
restricted login deliberately lacks.

## 4. Deploy the preview and check

| Check | How | Expect |
| --- | --- | --- |
| Starts with isolation | `curl https://<preview>/api/health` | `ok: true`, `storage: postgres`, `tls` an sslmode that verifies the certificate (not `none`); Vercel logs show no `WARNING` and no `tenant isolation cannot be guaranteed` |
| Runtime login is restricted | Neon SQL: `SELECT usename FROM pg_stat_activity WHERE datname='neondb'` during requests | `tend_app`, not `neondb_owner` (the owner appears only at cold starts) |
| Grants | Neon SQL: `SELECT has_table_privilege('tend_app','events','DELETE'), has_database_privilege('tend_app','neondb','TEMPORARY')` | `f, f` |
| Security headers | `curl -sI https://<preview>/` | HSTS, CSP, `X-Content-Type-Options`, `frame-ancestors 'none'`; session cookie `__Host-…; Secure; HttpOnly; SameSite` |
| Tenant matrix | run `redteam/live/tenant-matrix.mjs` against the preview (it needs its own adaptation to a remote URL: **not built**) | — |
| Alerts | 30 wrong sign-ins on a synthetic account | one `auth_failures` alert at the webhook |
| Backup | Neon: create a branch from a past point in time; start a second preview against it; `npm run tend -- audit-verify --checkpoint …` | verifies against a checkpoint taken before |
| Pooling | 50 concurrent requests from two synthetic tenants (e.g. the e2e suites against the preview URL) | no cross-tenant data, no `prepared statement` errors |

## 5. Rollback

Redeploy the previous Vercel deployment. Migrations are additive (new columns, tables, functions, policies); the previous code ignores them.
Do not drop `tend_app` while any deployment uses it.

## Not covered

Rate limits are per serverless instance (and per database for the ones stored in `rate_limits`); put Vercel's firewall rate limiting in front
for volumetric abuse. Logs: TEND never logs secrets or request bodies (`docs/monitoring.md`); Vercel's own request logs contain URLs and IPs.
