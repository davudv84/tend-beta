# Incident response

For anyone running TEND. Keep it short in an incident; details are in `docs/operations.md`.

## Severity

| Level | Examples | Response |
| --- | --- | --- |
| SEV-1 | Cross-tenant data exposure; an agent action ran without the approval TEND should have required; admin token, context key or database credentials leaked; audit log altered | Start now, all hands, notify affected customers once the facts are clear |
| SEV-2 | One account or agent key compromised; a bypass that needs unusual conditions; start-up running without isolation in production | Same day |
| SEV-3 | Hardening gaps, noisy failures, a vulnerability with no known exploitation path | Next release |

## Steps

1. **Record.** Open one incident note: time, who, what was seen. Write every action with its time. Do not paste secrets into it.
2. **Preserve.** Before changing anything: take an audit checkpoint (`npm run tend -- audit-verify`), export `auth_events` (`/api/admin/audit`),
   keep the provider's logs, and take a database snapshot or dump (`docs/operations.md`).
3. **Contain** (pick what applies):
   - Agent misbehaving: pause it (dashboard, `POST /api/v1/agents/<id>/control`) and revoke its key (`DELETE /api/v1/agents/<id>/keys`).
   - Account compromised: an admin disables it (`/api/admin/users/<id>`), which ends its sessions; revoke the agent keys it created.
   - Admin token leaked: rotate `TEND_ADMIN_TOKEN` (ends every admin session).
   - Context key or database credentials leaked: rotate them (`docs/operations.md`), then the runtime role's password.
   - Tenant isolation in doubt: keep `TEND_DB_ISOLATION` on; if the application layer is suspected, take the service offline rather than turn
     isolation off.
4. **Investigate.** `audit-verify --checkpoint <the last kept one>`; `npm run tend -- audit` for the agents involved; `auth_events` for sign-ins
   and rejected keys around the time. Work out which tenants, agents and actions are affected.
5. **Fix** with a regression test that fails before the fix. A second person reviews it.
6. **Recover.** Restore from backup only into a new database and verify it (`docs/operations.md`, "After a restore").
7. **Communicate.** Tell affected customers what happened, what data or actions were involved, what was done, and what they should do (for
   example rotate their agent keys). Meet any legal notification deadlines that apply to you (e.g. GDPR: 72 hours to the authority for a personal
   data breach).
8. **Review** within two weeks: timeline, cause, why tests did not catch it, follow-up actions with owners.

## Not in place yet

- An on-call rotation and paging. TEND has no built-in alerting (`docs/operations.md`, "Monitoring").
- A rehearsed incident (tabletop exercise). **Not done.**
