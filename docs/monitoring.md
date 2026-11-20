# Security monitoring

`src/server/security-events.ts`. Labels: **VERIFIED** (tested here), **IMPLEMENTED BUT UNVERIFIED**, **NOT IMPLEMENTED**.

## What is emitted (VERIFIED: `src/server/security-events.test.ts` MON-1…4)

One JSON line per security event on the server's log (`console.warn`), e.g.
`{"tend":"security","kind":"signin.failed","severity":"low","at":…,"fields":{"account":"h:1a2b3c4d","client":"203.0.113.0/24","reason":"invalid_credentials"}}`.
Redaction: fields named like a password, token, key, cookie, MAC, nonce or code are dropped; accounts, sessions and anything with `@` are
hashed (8 hex); addresses are cut to /24 (IPv6 /48); agent keys inside text are masked; values are bounded.

Sources: every authentication-log entry (sign-in success/failure/blocks, rejected sessions and agent keys, account and member changes, two-step
events), refused operator requests (403 for missing rights, `*_not_found` for ids of another workspace), server errors on authorization/gateway
routes, start-up refusing tenant isolation, audit-chain checks (`/api/admin/audit`, also behind `npm run tend -- audit-verify`), and agent key
and policy changes.

## Alert rules (per server instance)

| Rule | Counts | Threshold | Severity | Action (`docs/incident-response.md`) |
| --- | --- | --- | --- | --- |
| auth_failures | failed/blocked sign-ins | 25 in 5 min | high | check the source addresses; consider blocking at the edge |
| auth_failures_account | failed sign-ins, one account | 10 in 15 min | medium | tell the account owner; suggest two-step sign-in |
| mfa_failures | wrong codes after a right password, one account | 3 in 15 min | high | the password is probably known: reset it, check sessions |
| suspicious_api_keys | unknown/revoked agent keys | 50 in 5 min | medium | a leaked or old key in use somewhere; find the client |
| repeated_denials | refused requests from one authenticated session or agent (requests before authentication are not counted) | 30 in 5 min | medium | probing for other tenants' ids or for rights; SEV-2 if from a member |
| tenant_isolation_failure | start-up refused isolation | 1 | critical | SEV-1 until explained: the database roles changed |
| audit_integrity | audit chain did not verify | 1 | critical | SEV-1: preserve evidence, compare with the kept checkpoint |
| enforcement_error | 5xx on authorization/gateway routes | 3 in 5 min | high | agents fail closed (actions refused); restore service |
| privilege_change | role changes, invitations, two-step off, key revocations, policy changes in one workspace | 20 in 10 min | medium | confirm with the workspace owner |

One alert per rule and key per 15 minutes. Every event still produces its log line.

## Delivery

`TEND_ALERT_WEBHOOK_URL`: each alert is POSTed as JSON (`source, rule, severity, count, windowSeconds, summary, at, service`), no customer data.
HTTPS is required on a production server. Works with anything that accepts a webhook (Slack incoming webhooks need their own payload shape:
put a small relay in front, or use a tool such as PagerDuty's or Opsgenie's generic webhook integration).

- **VERIFIED:** delivery to a receiver on this machine over HTTP, from the unit tests (MON-4) and from a production build reacting to 30 real
  failed sign-ins (`scripts/alerts-e2e.mjs`, embedded database and PostgreSQL): exactly one alert, no e-mail, password or address in it.
- **NOT VERIFIED:** delivery to a real paging or chat service; behaviour across many serverless instances.

## Limits

- Counters are in memory per instance. On Vercel a distributed attack may stay under every threshold. Forward the log lines (Vercel log drain)
  to a log platform and put the same rules there; the line format above is stable for that.
- No persistence of alerts, no dashboard, no on-call routing (operator-side, `docs/incident-response.md`).
- Scheduled audit-chain verification is not built in: run `npm run tend -- audit-verify --checkpoint …` from a scheduler (a failure raises the
  critical alert through the same route).
