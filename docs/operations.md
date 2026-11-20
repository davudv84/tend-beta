# Operating TEND securely

Procedures for whoever runs a TEND deployment. Each one says what was tested and where; anything marked **not tested** is a plan, not evidence.

## Responsibilities

| Area | Owner (fill in before production) | What it means |
| --- | --- | --- |
| Security contact and triage | _name_ | Receives reports (SECURITY.md), assigns severity, runs `docs/incident-response.md`. |
| Secrets | _name_ | Holds and rotates the secrets below; nobody else has them. |
| Database | _name_ | Backups, restores, the owner and runtime roles, grants after releases. |
| Releases | _name_ | Reviews changes to `src/server/db.ts`, `policy.ts`, `authz.ts`, `http.ts`, `session.ts` with a second person; CI must be green. |
| Audit checkpoints | _name_ | Takes and keeps audit-chain checkpoints outside TEND (below). |

One person may hold several roles, but the release reviewer should not be the only author of a security-relevant change.

## Secrets and how to rotate them

Keep secrets in the hosting provider's secret store (e.g. Vercel environment variables marked sensitive), never in the repository. `.env*` files
are git-ignored and CI runs secretlint.

| Secret | Used for | Rotation | Effect |
| --- | --- | --- | --- |
| `TEND_ADMIN_TOKEN` | platform admin sign-in | Set a new value (32+ random characters), redeploy. | Every admin-token session ends (sessions are bound to a key derived from the token, `src/server/session.ts`). Account sessions are unaffected. |
| `TEND_CONTEXT_KEY` | signs the tenant context the database policies verify | See below. | Wrong or missing key: the server refuses to start, or (key removed while running) sees no tenant rows. |
| Agent API keys | each agent's identity | Dashboard or `POST /api/v1/agents/<id>/keys` (rotate), `DELETE` (revoke). Optional expiry: `keyExpiresInDays`, `TEND_KEY_MAX_AGE_DAYS`. | Old key refused at once; recorded as `key.rotated` / `key.revoked`. |
| Account sessions | operators' browsers | `DELETE /api/operator/sessions` (sign out everywhere); a password reset also ends all of that account's sessions. | Agent keys keep working: revoke them separately after a suspected compromise. |
| `DATABASE_URL`, `DATABASE_MIGRATE_URL` passwords | database logins | Change the password in the database provider, update the variable, redeploy. | **Not tested here** (provider-specific). |
| `TEND_VAPID_PRIVATE_KEY` | browser push | Generate a new pair, set both keys, redeploy. | Existing browser subscriptions stop receiving pushes until the browser subscribes again. **Not tested here.** |
| Mail provider key | sign-up and reset mail | Rotate in the provider, update the variable. | **Not tested here.** |

### Rotating `TEND_CONTEXT_KEY`

Keys live in the owner-only table `tend_context_keys`; several can be valid at once, so rotation needs no downtime:

1. Generate a key: `openssl rand -base64 48`.
2. Deploy with the new value. On start-up the server installs it next to the old one (with `DATABASE_MIGRATE_URL`, through the owner connection).
   Instances still running with the old key keep working.
3. When no instance uses the old key any more, remove it as the schema owner. The key id is the first 16 hex characters of
   `sha256(old key)`:
   ```sql
   SELECT kid, created_at FROM tend_context_keys ORDER BY created_at;
   DELETE FROM tend_context_keys WHERE kid = '<old kid>';
   ```
   A server that still holds the removed key now sees no tenant rows (fails closed) and a restart with it is refused.

Tested on PostgreSQL 16: `scripts/ops/context-key-rotation-drill.mjs` (both keys valid during rollout; old key fails closed after removal; a key
never installed sees nothing). In single-URL mode (the application logs in as the owner) a server restarted with an old key re-installs it; the
key only protects anything with a restricted login (`docs/database-roles.md`).

## Backups and recovery

The database holds everything: accounts, agents, rules, the audit log, and the context keys. Back it up with the provider's point-in-time
recovery (Neon, RDS, …) **and** periodic logical dumps kept elsewhere:

```bash
pg_dump --format=custom --no-owner --file tend-$(date +%F).dump "$DATABASE_MIGRATE_URL"
```

Restore into a new database, never over the live one:

```bash
createdb tend_restore
pg_restore --no-owner --dbname "postgres://…/tend_restore" tend-2026-01-01.dump
```

After a restore, before pointing the application at it:

1. Start TEND against it with the same `TEND_CONTEXT_KEY` (the key table is in the dump; a different key is refused at start-up).
2. `npm run tend -- audit-verify --checkpoint "<last checkpoint you kept>"`. A dump taken after a tampering is caught here, not by a bare walk.
3. Re-run `node scripts/db-grants.mjs <runtime role>` if the runtime role is separate (`--no-owner` restores grant nothing).

Tested on PostgreSQL 16 (`scripts/ops/backup-restore-drill.mjs`, local cluster, synthetic tenants): dump 72 KB in 56 ms, restore in 124 ms; the
restored log verified against the checkpoint taken before the dump; tenant isolation started with the same key; agents' keys and the approval
flow worked on the copy; deleting the oldest events on the copy was missed by a bare walk and caught by the kept checkpoint. **Not tested:**
provider point-in-time recovery, restore time at production size, a restore drill on the hosted database.

Recommended targets (to be confirmed by the operator): recovery point 24 hours or better (point-in-time recovery: minutes), recovery time
4 hours. Run the drill at least quarterly and record the times.

## Audit checkpoints

`npm run tend -- audit-verify` prints a checkpoint (`firstSeq:firstHash:headSeq:head`). Store it outside TEND (a ticket, a signed message, a
second system) daily and after every incident. Later runs with `--checkpoint …` detect a rewrite, a deleted prefix or an altered oldest entry up
to that point. Without a kept checkpoint a database owner can rewrite and re-chain history undetectably.

## Monitoring

TEND emits redacted security events and raises alerts to `TEND_ALERT_WEBHOOK_URL` (`docs/monitoring.md`). Also forward logs to the provider's log drain and alert on these:

| Signal | Where | Meaning |
| --- | --- | --- |
| `[tend] unhandled error` | server log | A route failed; the response was 500. |
| `[tend] WARNING: TEND_DB_ISOLATION=off` / `… not a role split` / `… embedded single-process database` | start-up log | Production is running without a protection it should have. |
| start-up refused (`tenant isolation cannot be guaranteed`, `database schema is out of date`) | start-up log | Deployment misconfigured; nothing is served. |
| `[tend] could not write to the authentication log` | server log | Sign-in auditing is failing. |
| `signin.failed`, `signin.blocked`, `agentkey.rejected`, `log.suppressed` rising | `auth_events` (`/api/admin/audit`) | Guessing or a flood of bad keys. `log.suppressed` means records were dropped. |
| `key.revoked`, `policy.updated`, `policy.central_updated`, `account.disabled` | `events` / `auth_events` | Security-relevant changes; review that each was expected. |
| `audit-verify` not ok | scheduled job | The log was changed. Treat as an incident. |
| `GET /api/health` not `ok`, or `schema` lower than expected | uptime check | Down, or an old schema. |

**Not implemented:** metrics, persistent alerts, anomaly detection, a SIEM integration. Alert counters are per server instance.

## Vulnerability management

- CI (`.github/workflows/security.yml`): `npm audit` (production dependencies at any severity, all at critical), Semgrep,
  eslint-plugin-security, secretlint, the security test suites on embedded and real PostgreSQL, mutation controls. No CodeQL, no dynamic
  scanner (ZAP) and no git-history secret scan are configured. **CI has not been run on GitHub yet** (it was written and run locally, piece by piece).
- Dependencies: review `npm audit` weekly; patch critical/high within the SLA in SECURITY.md.
- Every fixed vulnerability gets a regression test named after it (see `SECURITY-VERIFICATION.md` for the pattern).
