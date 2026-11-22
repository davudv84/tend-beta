# Runbook: backups and restores

TEND's state is one PostgreSQL database: accounts, agents, policies, authorizations, and the append-only, hash-chained event log. Restoring an
old backup brings back old state; it never re-opens an approval (a spent authorization stays spent), but anything done after the backup is lost
from TEND's records, so treat a restore as an incident and record it.

## Backups

- **Hosted (Neon):** point-in-time restore is built in; check the retention window in the Neon console matches what you promise (at least 7
  days). Also keep an independent logical backup at least daily:
  `pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" > tend-$(date +%F).dump`, stored encrypted, outside the database provider.
- After each backup, record the audit checkpoint: `npm run tend -- audit-verify` prints it. Keep it with the backup and somewhere TEND cannot
  write; it is how you prove later that nobody edited history.

## Restore (and the drill)

1. Restore into a **new** database, never over the live one:
   `createdb tend_restore && pg_restore --no-owner --no-privileges --exit-on-error --dbname "$RESTORE_URL" tend-YYYY-MM-DD.dump`
2. Verify before switching anything:
   - row counts per table match what the backup should hold;
   - `npm run tend -- audit-verify --checkpoint "<the checkpoint kept with that backup>"` passes;
   - `/api/health` against a server pointed at it shows the expected schema version.
3. Point `DATABASE_URL` at it, redeploy, and **rotate the admin token** (docs/runbooks/secret-rotation.md): sessions in a restored database may
   belong to people who should not have them any more.

The drill does all of this against a throwaway local PostgreSQL, with checks a person would otherwise eyeball, and runs in CI on every change:

```
TEND_DRILL_DATABASE_URL=postgres://user@127.0.0.1:5432/postgres npm run drill:backup
```

It seeds realistic state, dumps it with `pg_dump`, restores into a fresh database with `pg_restore`, and checks: identical row counts in every
table; the audit chain verifies against the source's checkpoint; the log is still append-only; a spent authorization is still spent; a pending
request is still pending.

**Not done from here:** a restore drill of the hosted database itself (needs Neon access). Do one per quarter and record the date and the result.
