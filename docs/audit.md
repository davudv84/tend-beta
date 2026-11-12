# Audit trail, approver identity and what protects them

What Tend records about decisions and changes, how far that record can be trusted, and what it cannot promise. Read the
last two sections before relying on it: several protections depend on how you deploy Tend.

## What is recorded

Every change to agents, policy, reviews and authorizations writes an event in the same transaction as the change, so
such a change cannot commit without its event. Two exceptions: presence (an agent's last-seen time) changes without an
event, and a gateway tool's outcome is written afterwards (see below).
Events carry a sequence number (`seq`), the agent, a time, an `actor` and a small `data` object. Tokens, keys and tool
output never go into events.

| Action | Event | Recorded besides what changed |
|---|---|---|
| A person approves or rejects | `review.decided` | `by`, the note, the `authorizationId` if it was an authorization |
| Policy saved | `policy.updated` | `by`, `version`, the **full rule set** in `policy`, the rule count in `rules`, `enforcement` |
| Pause, resume, disable, enable | `agent.paused`, `agent.resumed`, `integration.disabled`, `integration.enabled` | `by`, `version` |
| Agent registered, key rotated, key revoked | `agent.registered`, `key.rotated`, `key.revoked` | `by`; a revocation also records how many waiting requests it cancelled (`authorization.cancelled`, reason `key_revoked`) |
| Status report requested | `checkin.requested` | `by` |
| Authorization requested, denied, consumed | `authorization.*` | tool, action, resource, detail, reason |
| Gateway tool ran | `tool.called` with `via: "gateway"` | outcome, `authorizationId`, error code (never upstream text) |

## Approver identity: what `by` means

`by` is the **session id** of the operator who acted. It is random, created at sign-in, and belongs to a session row on the server
(the cookie holds the id and a 256-bit secret; only the secret's hash is stored), so it cannot be changed or borrowed without that secret. All the routes that change something take it from the
session, never from the request body.

It is not the name of a person. Tend has one shared admin token, so everyone who signs in is "an operator" and two people
with the token cannot be told apart except by which sign-in session they used. If that matters to you (separation of
duties, regulated approvals), Tend does not provide it yet. Other limits:

- Signing out revokes the session on the server, and so does "Sign out everywhere" (Settings → Security). A revoked, expired or
  superseded session is refused on its very next request. A stolen cookie works until one of those happens (at most 12 hours),
  or the admin token is rotated, which ends every session for good.
- Sign-ins, failed attempts, blocks, sign-outs, sign-out-everywhere and the reuse of a revoked or expired session are recorded in the
  append-only `auth_events` table (type, time, session id, the trusted address, a reason; never the token or a secret). A failure
  record is bounded: past 60 a minute one line says so. The operator sees the latest in Settings → Security.
- The demo routes (`/demo/reset`, `/demo/check-ins`) require a session but do not record `by`.

## What visitors of a public instance can see

A public instance (`TEND_PUBLIC`) lets anyone read the dashboard feed without signing in. What they get is decided in one place,
`src/server/redact.ts`, for every event on both read paths (`/api/v1/state` and `/api/v1/events`):

- **Demo agents** are invented, so their seeded sample text stays. That is the public demonstration. What an operator does to a
  demo agent live (a comment on a decision, a pause note, a check-in written by hand) is not sample text and is treated like a
  connected agent's.
- **Connected agents an operator marked public** show only the *shape* of their activity: which tool and action, the outcome, the
  status of an approval, when, and how often. Never the contents: no request parameters, resource names, invoice or customer
  details, note text, operator comments, error messages, task titles or other free text the agent wrote, check-in text,
  policies, enforcement settings, key fragments, operator session ids or verification results.
- It is an **allowlist per event type**. A field added to an event later stays hidden until someone lists it, and an event type
  that is not listed shows nothing at all.
- Operators see everything. A signed-out user, a visitor holding an agent's API key, or someone with a forged cookie gets exactly
  what any visitor gets, and on a private instance nothing (401).

What a visitor can still learn from a public connected agent: its profile (name, model, role, description, permissions, which an
operator wrote for display), the names of the tools and actions it uses, outcomes, timing and volume, and the structured answers
and confidences in its check-ins (not the free-text explanation written with each answer; that was shown until the overnight
review of 2026-10-28 and is now removed, with a test). Mark an agent public only if that is acceptable. Rate limits on the public feed use the client
address as sent, so they are only as good as the proxy in front.

Tested in `src/server/disclosure.test.ts`, including with the redaction deliberately weakened.

## Append-only history

An `events` row cannot be updated or deleted, and the table cannot be truncated, by an ordinary statement: a database
trigger refuses it (SQLSTATE `42501`). Deleting an agent would cascade into its events, so that is refused too. The only
exception is a transaction that sets the `tend.maintenance` flag (`allowEventRemoval` in `db.ts`), which the demo's own
retention and reset do, and only for simulated data. The flag lasts one transaction and does not reach other connections.

What this protects against: application bugs, and injected or mistaken statements that do not know about the flag.

What it does **not** protect against: a database owner or superuser, who can drop the trigger or edit the files;
anyone who can run statements that set the flag; and rows in other tables. `authorizations` and `reviews` change status
by design, so their history lives in the events, not in those rows.

The events table does carry a hash chain (each event's hash covers the previous hash and its own content, sequence number
included), so a rewrite is *detected* even though the trigger cannot *prevent* it — provided you keep the checkpoint
`audit-verify` prints outside Tend and re-check against it (`--checkpoint …`), which covers a deleted prefix and an
altered oldest entry as well as an interior rewrite. Without a kept checkpoint, a database owner who rewrites and recomputes
the whole chain leaves no trace Tend can see. Other tables (`authorizations`, `reviews`) have no such chain.

## When the outcome cannot be written

Authorizing and acting are separate steps. `authorization.consumed` is written in the same transaction as the consume. The
outcome (`tool.called`) is written after the tool ran, so it cannot join that transaction. The gateway retries the write
up to 3 times. If it still fails, the result is returned (the action happened), a line without any detail is logged, and
the missing outcome is the visible gap: a `consumed` authorization with no matching `tool.called`.

## Deployment-dependent protections

These hold only if you set Tend up for them:

- **Database privileges.** Append-only is only as strong as who can alter the schema. Run the app with a database user
  that does not own the tables and cannot drop triggers, and keep the owner credential out of the app's environment.
- **HTTPS and cookies.** Session cookies are `HttpOnly` and `SameSite=Strict`; in production builds they are also `Secure` and carry the `__Host-` prefix (site-wide, no Domain).
  Serve Tend over HTTPS.
- **A strong admin token.** Only its length is checked (at least 24 characters). Make it random.
- **A trusted client address.** Sign-in rate limits use `X-Forwarded-For` as sent, so they are only as good as the proxy in
  front that overwrites it. Not addressed yet.
- **Separating the agent from what it protects.** See [gateway.md](gateway.md). Tend cannot enforce it.

## How this is verified

- `src/server/audit.test.ts`: session ids and tampering, `requireOperator`, `by` on every operator action, the policy
  history, outcome retries, append-only, the maintenance flag, and the demo reset and pruning. Each protection was
  switched off in turn to confirm a test fails without it.
- `src/server/routes.test.ts`: every API handler is classified and must call the guard for its class (static check).
- `src/server/postgres.test.ts`: the same guarantees on **real PostgreSQL** with a real connection pool, including
  overlapping consumes, overlapping decisions, overlapping policy saves and the gateway running a tool once. The in-memory
  database runs one connection, so it cannot show these. `npm run test:postgres` starts a throwaway local cluster
  (needs `initdb` and `pg_ctl`), runs the file and deletes the cluster. CI runs it against a `postgres:17` service.
  With `TEND_TEST_DATABASE_URL` unset the file is skipped. It refuses a non-local server and only creates and drops
  databases it names itself.

## Not implemented

- Named approvers and per-person accounts.
- Automatic off-site anchoring of the checkpoint (today you keep it yourself; `audit-verify` prints it and re-checks against it).
- Export of the authentication log, and alerting on it.
- Retention and export of the log.
