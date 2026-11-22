# Security review, November 2026

An internal, code-level review of this repository on branch `claude/blissful-euler-7j8rdz`. It is **not** an independent penetration test, not a
certification, and not a statement that TEND is production-ready. Everything below says how it was checked; "verified" means a check ran here and
passed, against a local isolated server with fictional data. Nothing was run against a hosted instance, Vercel, Neon or any third party.

## Verdict

**LIMITED PILOT READY**, on these conditions: fictional or non-critical data; agents connected through the SDK or MCP proxy (or the gateway) with
the **Strict** preset or a hand-written policy, not Balanced; a small number of known operators; the admin token kept by one person.
**Not** ready for independent review until CI exists to run the checks below on every change (see "Next").

## Architecture and trust boundaries

```
 browser ──(session cookie, same-site)──► Next.js routes ──► repo/authz/policy ──► PostgreSQL (hosted) | PGlite (local)
 agent ────(agent key, Bearer)──────────► /api/v1/authorize, /spend, /events …     │
   └─ SDK (tend.mjs) / hooks (tend-hooks.mjs) / MCP proxy: ask, then run the tool  │ append-only, hash-chained events
 gateway tools (fake payments, notes, sandbox files): TEND holds the credential and runs the tool itself
```

- **Where a tool call is stopped.** Only in code that asks TEND first: the SDK's `guardTool`/`gate.run`, the coding-assistant hooks, the MCP proxy,
  or TEND's own gateway. Each runs the tool only after TEND answered "authorized" for exactly that request. An agent that holds a tool's real
  credentials can call it directly; TEND cannot stop that (docs/security-limitations.md). Only the gateway puts the credential behind TEND, and it
  ships demonstration tools only.
- **Tenancy.** Account → one workspace. Every operator route resolves the session server-side and checks that an id belongs to the session's
  workspace (`agentInWorkspace`, `reviewInWorkspace`, `centralInWorkspace`); agent keys are bound to one agent. No RLS: isolation is in the
  application layer, enforced by `routes.test.ts` (static: every handler calls its guard) and exercised over HTTP.

## Threat model (condensed)

| Attacker | Wants | Main controls | Status |
|---|---|---|---|
| Compromised or prompt-injected agent | Run an action without approval | Policy decided server-side; deny by default; approval bound to the exact request fingerprint; single-use spend | Verified (demo below) |
| Same, rewording a shell command | Get past preset rules | Text match only | **Finding H-1** |
| Stolen agent key | Act as the agent | Key revocation is immediate, waiting approvals stop | Verified |
| Replay / lost-answer retry / duplicate delivery | Run once-approved action twice | Atomic `UPDATE … WHERE status='approved'`, idempotency keys | Verified, incl. 25-way race on PostgreSQL |
| Malicious tenant | Read or change another workspace | Workspace check on every id; not-found for foreign ids | Verified over HTTP (embedded DB) |
| Cross-site attacker | Make an operator's browser act | `__Host-` cookie, SameSite=Strict, Origin and Sec-Fetch-Site checks, CSP `frame-ancestors 'none'` | Verified |
| Agent forging the audit log | Insert "a human approved" | Agents may post 9 event types only, actor forced to `agent` | Verified (code) |
| Database writer | Rewrite history | Hash chain + externally kept checkpoint | Detects only; documented |
| Network attacker between app and database | Read credentials and data | TLS with certificate checks | **Finding M-2 (fixed)** |
| Malicious MCP server | Name a destructive tool like a harmless one; inject instructions via tool descriptions | Policy binds tool name + arguments only | Not addressable by TEND; documented (I-2) |
| Compromised dependency | Code execution at build or run time | Lockfile with integrity hashes, single registry | No CI, no alerts (L-2) |

## Claims on the website, mapped to code and tests

| Claim (/security) | Code | Evidence |
|---|---|---|
| Asks before acting; exact request; changed / reused / expired / revoked refused | `src/server/authz.ts` (`requestAuthorization`, `spendApproved`, `consumeAuthorization`), `public/sdk/tend.mjs` (`createGate`) | `authz.test.ts`, `e2e:authz` (26), `e2e:enforcement` (30) |
| Fails closed | SDK `stop()` paths; `evaluate()` invalid policy → deny | `e2e:enforcement` (down, hang, 500, lying 200, lost answer), `failure-modes.test.ts` |
| One central policy; agent rules only stricter | `evaluateEffective` | `central-policy.test.ts` |
| Looks at arguments; malformed never satisfies | `policy.ts` `holds()` | `conditions.test.ts` |
| At most once | idempotency + atomic spend | `revoke-race.test.ts`, `e2e:enforcement` concurrency (embedded and PostgreSQL) |
| Keeps a hash-chained record | `audit-chain.ts` | `audit-chain.test.ts`, `audit.test.ts` |
| Separate identities | `agent-auth.ts`, `mine()` scoping | `agent-keys.test.ts`, `tenancy.test.ts`, `e2e:accounts` (30) |
| Balanced preset: "publish, delete, sudo, network wait for you" (product UI) | `src/lib/agent-presets.ts` | **Was false for reworded commands (H-1). Wording corrected; `agent-presets.test.ts` pins the facts** |

## Findings

No Critical findings. Severity is for the shipped defaults.

**H-1 · The Balanced preset is a text tripwire, presented as a boundary.** `src/lib/agent-presets.ts`, `presetRules("balanced")`. It is the
pre-selected preset when a coding assistant is connected. Its shell rules are substring matches, so reworded commands run with no person asked:
`git -C . push`, `find … -delete`, `python3 -c "…urlopen…"`, `su -c …`, and `cat ~/.ss?/id_rsa` (the plain form of which is "Never allowed").
Prerequisite: an agent that rewords a command, which a prompt-injected or merely inventive model will do.
*Done:* the product description (EN/DE), the public /security page and docs/security-limitations.md now say what it is; tests prove Strict never
lets any of these run unasked and pin the Balanced cases so a change has to update the docs. *Not done (needs a product decision):* changing the
rules. `presetOf()` compares saved policies to the current preset exactly, and the picker falls back to showing "Balanced", so editing a preset
would mislabel every saved one. *Recommended:* versioned presets (a v2 Balanced that allows a short list of read-only commands and asks for
everything else), recognising v1 as "Balanced (v1)" with an "update" action.

**M-1 · Strict reads `.env` without asking; Balanced asks.** Same file. Strict allows `file.read` everywhere except `.ssh`, so the stricter preset
protects secrets files less. Its description ("Reading files is allowed") is accurate, so this is a design gap, not a false claim. Fix with H-1's
versioned presets. Documented in docs/security-limitations.md.

**M-2 · A database URL without `sslmode` was used without TLS. Fixed.** `src/server/db.ts`, `verifiedTls()`. Only `allow/prefer/require/verify-ca`
were upgraded to `verify-full`; a hand-written `postgres://…@db.example.com/…` with no `sslmode` sent the password and all data in clear text.
Now any non-loopback host without `sslmode` is pinned to `verify-full`; loopback and an explicit `sslmode=disable` are left alone.
Test: `db-tls.test.ts`.

**L-1 · The isolated server's "is this port ours?" check was blind, and failed open. Fixed.** `scripts/isolated-server.mjs`, `listeners()`. lsof
4.95 skips any process whose name contains " (", and Next names its server `next-server (v16.4.6)`, so no listener was ever found and the guard
against a stale server passed without checking. This was the one failing test. Now Linux reads `/proc/net/tcp*` and socket inodes, and an
unidentifiable listener is refused. Test: `isolated-server.test.ts` (fails on the old code, passes now).

**L-2 · No CI, no dependency alerts, branch protection unknown.** There is no `.github/`; nothing runs the checks below on a change, and nobody
is told about a new advisory. `vercel.json` disables Git deployments. Branch protection could not be checked from here.

**L-3 · Four moderate advisories remain:** `shadcn` → `ts-morph` → `@ts-morph/common` → `minimatch` (GHSA-g3hv-75wg-m249, ReDoS via crafted
glob). TEND uses `shadcn` only for `@import "shadcn/tailwind.css"` at build time; nothing in `src/`, `scripts/` or `examples/` loads ts-morph or
minimatch, and no untrusted glob reaches them. Not exploitable in TEND. npm's only offered fix is a downgrade to shadcn 1.0.0 (a breaking change).
Residual risk: none at runtime; remove when shadcn updates ts-morph.

**I-1 · Real enforcement of third-party tools needs the credential behind TEND.** The gateway ships fake payments, notes and a sandbox folder only.
For any real tool, TEND is as strong as the agent's wrapper (documented).

**I-2 · MCP servers are trusted for what their tools do.** The proxy binds the tool name and arguments; a server that implements `read_file` as a
delete, or puts instructions in tool descriptions, is not detected. Only connect MCP servers you trust.

**I-3 · One shared admin token; no MFA, SSO or roles** (documented). Acceptable for a pilot with one administrator; not for procurement.

## Demonstration: unauthorized agent actions have zero side effects

```
npm run build
npm run e2e:enforcement                                                   # embedded database, two tenants
TEND_E2E_DATABASE_URL=postgres://…throwaway-local… npm run e2e:enforcement # real PostgreSQL concurrency
```

A disposable tool records every real execution; the agent reaches it only through `connectTend` + `guardTool`. Result (embedded): **30 passed,
0 failed**; ledger `{"read_notes":2,"send_report":1}`: exactly the allowed and approved calls. Covered: allowed runs once; repeat delivery runs
once; denied, unlisted, rejected, undecided: zero; arguments claiming approval: zero; verdict fields in the request: 422; spend while pending:
409; other tenant approves / spends / revokes: 404; changed request: 403 mismatch; 25 concurrent spends: 1 succeeds, 24 refused; replay: 409 and
alert; expired token: 403; revoked key: 401 and zero; TEND down / hanging / 500 / lying 200: zero; lost answer after spend: not run and not
re-authorized. On PostgreSQL 16: 27 passed, 0 failed, 3 cross-tenant checks skipped (accounts need a mail service with a database URL) and not
counted as passed; the 25-way race again had exactly one winner.

## Tests run for this review

| Check | Result |
|---|---|
| `npm test` with a throwaway PostgreSQL 16 (`TEND_TEST_DATABASE_URL`) | 554 tests: 549 passed, 0 failed, 0 cancelled, 5 skipped (macOS `sandbox-exec` only) |
| `e2e:authz` / `e2e:accounts` / `e2e:gateway` / `e2e:enforcement` | 26 / 30 / 11 / 30 passed, 0 failed |
| `e2e:browser` | **Blocked**: needs WebKit (`npx playwright-core install webkit`), not installed here |
| Typecheck, lint, production build | Pass; lint 0 errors (1 warning in `.claude/skills/unslop`, unrelated) |
| `npm audit` | 4 moderate (L-3); 0 high, 0 critical. Lockfile: 816 packages, all from registry.npmjs.org, all with integrity hashes |
| Headers, cookies, CORS, methods, body size (local production server) | Strict CSP with nonce, `frame-ancestors 'none'`, HSTS; `__Host-` HttpOnly Secure SameSite=Strict cookie; no CORS grants; 405 for other methods; auth before body; 64 KB body limit |
| Secrets in client bundles and Git history | None found (only the variable name `TEND_ADMIN_TOKEN` in setup text) |

Not verified here: the hosted deployment (Vercel, Neon) and its environment variables, backups and restores, secret rotation, monitoring and
alerting, availability, and screen-reader behaviour.

## Next

1. **CI** that runs typecheck, lint, `npm test` against a throwaway PostgreSQL, `npm run build`, `e2e:authz`, `e2e:accounts` and
   `e2e:enforcement` on every pull request, with branch protection and dependency alerts. Without it, every result above can silently regress.
2. Versioned presets (H-1, M-1).
3. Two-tenant HTTP tests on PostgreSQL (needs a test mail sink for a database-backed server).
4. Per-operator admin accounts with MFA instead of the shared admin token.
5. Backup/restore drill and secret-rotation runbook for the hosted instance.
6. Independent penetration test.
