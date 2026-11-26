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

Remove the integration's `POSTGRES_URL*` variables from the preview scope if they point at the owner (TEND reads `POSTGRES_URL` only when
`DATABASE_URL` is unset).

## 3. Preflight (locally, values never printed)

The preflight reads a file of `KEY=value` lines (or the shell's environment when no file is given) and prints only what is wrong, never a value.

```bash
vercel env pull --environment=preview --git-branch=security/release-redesign .env.preflight
```
```bash
node scripts/check-production-config.mjs .env.preflight --expect-db tend_preview_fresh --runtime-user tend_runtime_v2 --migrate-user neondb_owner
```
```bash
rm .env.preflight
```
It must print "No blocking problems". The three `--expect-…` flags pin the preview database and the two logins by name, so a URL that points at another database or role fails here, before any deploy.

**If it says several variables "all hold exactly the same value"**: the file does not contain your real settings. It is a placeholder, or Vercel did not
export the values (a variable marked *Sensitive* cannot be read back, and a pull may write a stand-in for it; check Vercel's current documentation).
That is not something to fix variable by variable. Check the variables with `vercel env ls preview` (names and scope only), then run the preflight on a
file you build from your own copies of the values (the ones you generated and stored), readable only by you, and delete it afterwards:

```bash
umask 077 && ${EDITOR:-nano} .env.preflight
```

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
