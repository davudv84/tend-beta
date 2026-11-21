# TEND security verification

**Branch:** `security/verification` (local; nothing pushed, nothing deployed, `main` untouched). **Date:** 2026-11-18.
**Scope:** this repository, local throwaway instances (embedded PGlite and a local PostgreSQL 16), dummy credentials. No production, customer or third-party system was contacted.
**Who verified:** the same agent that wrote the previous fixes. Everything below is **self-authored evidence, reproducible from this repository. It is not third-party validation.** Where an outside tool ran (Semgrep rules, `npm audit`, secretlint, real Claude Code, real PostgreSQL), that is stated.

## 0. Bottom line

- The Phase 5 fixes were **not complete**. Independent re-testing found two more bypasses of the same bug class in the policy engine (a mixed list such as `amount: [5000, 1]`, and deny rules defeated by traversal paths, display-name addresses and hidden characters). Both are fixed with regression tests.
- Enforcement itself (authorize → approve → spend once, bound to exact arguments, revocable, expiring, atomic with the audit write) **held** under every attack I could build, on PGlite and on real PostgreSQL 16, and behind **real Claude Code 2.1.327** via TEND's hooks.
- TEND still only controls code that asks it. That is the central limitation, and it was reproduced (section 6), not just documented.
- **Private beta readiness: yes, with the conditions in section 9.** Not ready for real money, real customer data or a public launch.

## 1. Vulnerabilities and gaps found in this verification

| ID | Finding | Severity | Status | Evidence |
|---|---|---|---|---|
| V-1 | The Phase 5 fix for numeric rules still failed open for a **list whose elements disagree**: `amount: [5000, 1]` was **allowed** against "approve when amount > 50" (rule required *every* element to match). | Medium | **Fixed** | Reproduced on the Phase 5 code (first run of `EV-12`: `amount=[5000,1] → allow`). New fuzz property "a list is at least as strict as its strictest element": 247 violations before, 0 after (20,000 cases). |
| V-2 | **Deny and approve rules could be stepped around** by values the engine could not judge and treated as "no match": `/srv/../etc/passwd` against "deny pathUnder /etc", `Bob <bob@competitor.com>` or `a@x.com, b@competitor.com` against "deny emailDomainIn competitor.com", `rm\u0000 -rf`, `prod​`. | Medium | **Fixed** | `EV-15` fails on the previous commit (`expected 'deny', actual 'allow'`) and passes now. Fuzz property "a hidden character never loosens a decision": 180 violations in an intermediate version, 0 final. |
| V-3 | Agent-written **free text** (review reasons, task titles, check-in text, tool errors) still allowed zero-width, soft-hyphen, Hangul-filler, braille-blank and tag characters (`cleanText` only removed control and bidi characters). | Low–Medium | **Fixed** | Old `clean.ts` keeps `pay​ 50⁠…` (run directly). Test in `hardening.test.ts`. ZWJ/ZWNJ are kept so emoji and scripts still work. |
| V-4 | The person approving a cooperative request saw only the agent's one-line `detail`, **not the arguments the rules had decided on**. A request showing "EUR 1.00 to Supplier" could carry `amount: 5000`. | Medium | **Fixed** | Screenshot of the old card shows only "EUR 1.00 to Supplier". New card lists every argument, with hidden characters shown as `<U+202E>`; checked in headless Chromium on the production build (`redteam/live/approval-ui.mjs`: hostile markup shown as text, no script runs, no raw bidi or zero-width characters in the DOM). Visitors never receive `argsText` (allow-list in `redact.ts`). |
| V-5 | Agent API keys **never expire**. | Low | **Fixed (opt-in)** | `keyExpiresInDays` at registration/rotation, `TEND_KEY_MAX_AGE_DAYS` as a server cap. Expired keys fail at the door and inside in-flight approvals (`EV-13`). Default unchanged (no expiry). Needs migration 16 (see section 8). |
| V-6 | `TEND_APP_URL` accepted `http://` in production, so verification and reset links in mails could go over http. | Low | **Fixed** | Old `config.ts` returns the http URL in production (run directly). `config-hardening.test.ts`. |
| V-7 | **Noisy neighbour:** every write takes one database-wide advisory lock and quotas were per agent, so one workspace with many agents could starve all others. | Low | **Mitigated** | One request budget per workspace (`TEND_WORKSPACE_RPM`, default 3000/min) (`EV-16`). The global lock itself remains (section 7). |
| V-8 | 8 of the "nine failing tests" were a **test defect**: `gate.test.mjs` relied on an unref'd `AbortSignal.timeout` timer with a mock `fetch` that holds no socket, so the runner saw an empty event loop and cancelled the rest of the file. | Test defect, not a product bug | **Fixed** | Failed in the full `npm test` run on Node 22 (the 8 later subtests in the file were cancelled), passed when run alone on a quiet machine, so it depended on timing. After the fix it passed 6 parallel runs and the clean-checkout run under Node 24. |
| V-9 | The ninth failure, `isolated-server.test.ts` "port is held only by its own process tree", fails **only in this sandbox**. | Environmental | **Not fixed (not a defect)** | In this sandbox `lsof` cannot attribute the server's listening socket to any process, although `/proc/net/tcp` shows it listening. Fails the same way on a clean checkout under Node 24. Not proven to pass on GitHub's runners. |

Previously reported, re-verified independently: F-01 (type confusion), F-02 (approver text), F-04 (agent cap), F-05 (dependencies). F-01 was incomplete (V-1, V-2); the others hold.

## 2. Phase 1: the six Phase 5 claims

| # | Claim | Result | Class |
|---|---|---|---|
| 1 | Numeric rules fail closed | A bypass remained (V-1) and a related one (V-2); both fixed. Tested with 34 encodings of 5000 (strings, hex, Unicode digits, `Infinity`, `1e999`, nested, summaries, mixed lists), 8 differently spelled argument names, a missing argument and no arguments at all. | **VERIFIED** for the tested encodings (7 fuzz properties × 20,000 cases). A tool that reads an argument in a way TEND cannot see (for example a different key name) is outside what the engine can know. |
| 2 | Approval screens safe | See V-3, V-4. Hostile name, detail, arguments and task title render as text; no script, no CSP violation, no raw bidi/zero-width in the DOM. | **PARTIALLY VERIFIED.** Look-alike letters (Cyrillic "а" for Latin "a") are not detected anywhere. The exact-text box scrolls (max-height), so a very long command can push its tail out of view. |
| 3 | 50-agent cap holds under concurrency | 80 parallel registrations store exactly 50, on PGlite and on a real 6-connection PostgreSQL 16 pool. | **VERIFIED** (per workspace; an attacker with many accounts still multiplies it, limited by sign-up limits and admin approval). |
| 4 | Production dependencies clean | `npm audit --omit=dev`: 0. `npm audit signatures` could not run (download blocked). Snyk and OSV-Scanner are not available. All-dependency audit: 22 findings (13 high) in **dev tooling only** (picomatch ReDoS via shadcn, eslint, secretlint), no patched release. | **VERIFIED** against the npm advisory database only. |
| 5 | Lockout and rate limiting hard to bypass | Reviewed `clientIp` (IPv6 /64, mapped addresses, garbage, trusted-hop arithmetic) and exercised it. A client-supplied `X-Forwarded-For` is ignored unless `TEND_TRUSTED_PROXY` is set; with it set and **no proxy in front**, the client controls the address. Per-account lockout (20 failures/hour) lets anyone with an email address lock the owner out until a password reset (deliberate, see F-03). | **PARTIALLY VERIFIED.** Sound only if the origin is reachable solely through the proxy. |
| 6 | Security CI actually runs | **Not run on GitHub** (no push, no Actions access). I emulated the workflow step by step on a clean checkout under Node 24 (`.nvmrc`): 16 of 17 steps pass; `npm test` has 1 failure (V-9). | **PARTIALLY VERIFIED** |

## 3. Phase 2: real agent enforcement

What ran, against what:

| Integration | How | Result |
|---|---|---|
| **Real Claude Code 2.1.327** with its real model, TEND's PreToolUse/PostToolUse/SessionStart hooks, an isolated production-build TEND | `npm run e2e:claude-hooks` (27 checks), `e2e:claude-coverage` (19), `e2e:claude-coverage --expiry` (about 10 minutes, nobody answers: 6) | All pass on the final code. Allowed runs once and is recorded; denied never runs; approved runs once; the approval is spent once; revoked key and paused agent are blocked; a late approval after expiry is refused. |
| Hooks adapter fail-closed (`redteam/live/hook-failclosed.mjs`) | TEND stopped mid-approval, TEND down, no key file, 5 kinds of unreadable input | 11/11 blocked, none let through. |
| MCP proxy in front of the example notes server (`redteam/live/mcp-proxy.mjs`) | Real MCP stdio JSON-RPC; the server writes a ledger line only when a tool really ran | 13/13: denied tools never reach the server, name variants blocked, no-rule = deny, an approved call runs once with exactly the approved arguments, an identical second call asks again, TEND down = not forwarded. |
| Gateway (TEND runs the tool itself) | `e2e:gateway`, 46 live checks | Held (but see section 7: the gateway has only demo tools). |
| Cooperative HTTP API | 231 live attack checks, 17 independent module-level tests (`enforcement-verify.test.ts`), 29 module attacks (`redteam/attacks.ts`) | Held. |
| Real PostgreSQL 16 (6 pooled connections) | Existing 20 tests + 4 new (`postgres-verify.test.ts`) | 24/24: 80 parallel registrations → 50; 12 rounds of racing approve/reject/cancel/spend → at most one spend, only after approval, audit agrees; revoke racing 8 spends; **audit write fails ⇒ the authorization is not consumed**. |

| Guarantee | Class | Basis |
|---|---|---|
| Unauthorized actions are blocked before execution | **VERIFIED** for code that asks TEND (hooks, MCP proxy, wrapper, gateway). **NOT ENFORCED** for anything else (section 6). | Above |
| Approval tokens cannot be reused | **VERIFIED** | Token and spend flows, 25-way races, replay alerts, PG |
| Approved actions cannot be modified | **VERIFIED** | Fingerprint covers agent, tool, action, resource, detail and all arguments; 3 mismatches cancel the approval |
| Expired or revoked credentials rejected | **VERIFIED** | `EV-1…5, 13`, real Claude Code revoke and `--expiry` runs, PG |
| Cross-tenant access impossible via supported paths | **PARTIALLY VERIFIED** | 27 live cross-tenant checks, all `[id]` routes read, DAST over 47 routes. Isolation is **application-level only**: no row-level security, one shared database and lock. A missed workspace check or an injection would expose every tenant. |
| Concurrent requests cannot bypass approval | **VERIFIED** | PGlite and real PostgreSQL |
| Gateway or TEND failures never silently permit | **VERIFIED** | Hook, MCP, atomic audit write, DB failure injected by trigger |
| Audit records reflect decisions | **PARTIALLY VERIFIED** | `EV-9`: order, actor, bound fields, refusals, replay and mismatch alerts, no token or key in the log, chain verifies. The chain **detects** tampering; without a checkpoint kept outside TEND a database owner can rewrite it. `authorization.consumed` means "authorized once", not "ran"; `tool.called` outcomes are the agent's own claims. |
| Agents cannot bypass TEND through direct tool access | **FAILED outside the documented threat model; not applicable inside it** | Reproduced with real Claude Code: `{"disableAllHooks": true}` in a repository's own `.claude/settings.json` ran a blocked command with TEND hearing nothing. Same for any agent holding the real credential or skipping the wrapper. Documented in `docs/security-limitations.md` and the UI. |

## 4. Phase 3: scanners

| Tool | Result |
|---|---|
| Semgrep 1.186 (offline; Semgrep's public `semgrep-rules` repo pinned at `a5ad171`, JavaScript and TypeScript directories; the Semgrep registry was blocked, so this is **not** the full registry rule set) | 329 findings over 487 files, all triaged. **0 ERROR-severity findings in application code.** The remaining ERRORs are `gcm-no-tag-length` in two test/e2e scripts and an `http://127.0.0.1` Ollama probe in a script. WARNING/INFO findings: stylistic (`no-replaceall`, i18n, prop spreading), a variable named `alert` flagged as `window.alert`, and `detect-redos` on `DOMAIN`/`ADDRESS` (timed on 4 KB hostile inputs: under 1 ms). |
| eslint-plugin-security (project dev dependency, `eslint.security.config.mjs`) | 69 pattern warnings (object injection 43, non-literal fs path 19, regexes 6, timing 1). Each was read; none exploitable. Those rules are switched off with the reason written in the config; everything else fails the build. |
| secretlint (project dev dependency) | 5 hits, all dummy fixtures (`nobody:nopass@127.0.0.1:1`, `user:hunter2@example.com`); listed in `.secretlintignore`. |
| Secrets in history | Regex scan over all added lines of all 73+ commits: placeholders only. **Gitleaks and trufflehog could not be installed** (download denied), so this is not a gitleaks-grade history scan. |
| `npm audit` | Section 2, item 4. |
| Own DAST (`redteam/live/dynamic-scan.mjs`) | 47 API routes × anonymous/operator/agent × 7 verbs × up to 14 hostile bodies against a production build: **0 five-hundreds, 0 stack traces or paths in bodies**, no unexpected 200 for non-operators. 39 pages: every HTML page carries CSP, frame, nosniff, referrer, HSTS, COOP and permissions headers and sets no cookie. Spoofed Host, 9 KB cookie, 6 traversal probes: clean. |
| OWASP ZAP | **Not run** (no Docker daemon, no Java download). The scan above is a small substitute, not equivalent. |
| CodeQL | **Not run** (no CLI available here). Add GitHub's CodeQL workflow if the repository is public or has Advanced Security. |

## 5. Phase 4: ASVS L2 review (baseline, not a certification)

Checked by reading the code and by test: sessions (256-bit secret, hash only stored, immediate revocation, password change ends sessions, `__Host-`/Secure/HttpOnly/SameSite=Strict verified on a production build); agent keys (192-bit, SHA-256 at rest, immediate revocation, optional expiry); tenancy; CSRF (Origin, `Sec-Fetch-Site`, SameSite=Strict); XSS (no raw HTML sinks; hostile strings rendered in a real browser); SSRF (the only outbound URL an operator can set is a push endpoint on an allow-list, 26 variants tested; the gateway takes no URL, path or command); SQL (every statement parameterized; interpolated fragments are constants or placeholder lists); webhooks (none inbound); replay (tokens, idempotency keys, mail tokens single-use, atomic); headers; logging (no keys, tokens or bodies logged; unhandled errors log the error object, which may carry database detail); error handling (no leaks under fuzz); input limits (64 KB bodies, 4 KB arguments, depth 5).

## 6. What TEND cannot enforce (do not claim otherwise)

1. **It only controls code that asks it.** An agent that skips the wrapper, holds the real credential, or runs with hooks disabled acts without TEND and TEND cannot tell. Only the gateway model (credential held by TEND or the target service) closes this, and the gateway currently has only harmless demo tools (a fake payment, notes, sandbox files). It is **not** a general tool proxy.
2. **The agent describes its own call.** TEND binds an approval to exactly what was sent, not to what the tool does with it. Rules see only the arguments the agent sent; the person approving now sees all of them, plus the agent's own description.
3. **Rules over sequences, content scanning, prompt-injection detection: none.** Deny-lists on free text (`contains "rm -rf"`) remain trivially rephrasable. Write allow-lists.
4. **Direct-tool bypass through Claude Code project settings** (reproduced above). Use Claude Code managed settings to prevent it.
5. **The audit chain detects, it does not prevent.** Keep the checkpoint `audit-verify` prints somewhere outside TEND.
6. **Operator-side only.** One role, no 2FA, no SSO, a single shared admin token.
7. **At most once, not exactly once.** A crash after a spend leaves "authorized" with no outcome.
8. **Look-alike characters** in agent-written text are not detected.

## 7. Remaining risks (ranked)

1. **High (by design):** cooperative enforcement can be bypassed by the agent's host (section 6.1, 6.4).
2. **Medium:** tenant isolation is application-level with one global write lock; a missed check exposes all tenants and a busy tenant can still slow others down (V-7 mitigates).
3. ~~Medium: with no usable `TEND_ADMIN_TOKEN` and `TEND_PUBLIC` unset the instance becomes publicly readable.~~ **Fixed in round 2** (see section 12): a production build is locked unless `TEND_PUBLIC=1` is set.
4. **Medium:** rate limits rely on the proxy setup (`TEND_TRUSTED_PROXY` and an origin not reachable directly).
5. **Low:** per-account lockout (anyone with an email can lock the owner out for up to an hour, until a password reset). Deliberate, tested by the existing suite.
6. **Low:** dev-tool dependencies with high advisories (no patched release); `shadcn` is a build-time dependency (`globals.css` imports it), so the build must install dev dependencies.
7. **Low:** unhandled-error logging prints the error object.
8. **Info:** in production without `DATABASE_URL`, a non-Vercel deployment silently uses the embedded database.

## 8. Changes in this branch that could affect production

- **Migration 16** adds `agents.key_expires_at` (nullable, additive). Applied automatically at start-up.
- **Stricter policy semantics:** values the engine cannot judge are now "unknown", which makes deny/approve rules apply and ignores allow rules. A policy that relied on "wrong type = rule does not apply" (for example `deny … contains` on a number, or `approve when amount > 50` with `amount` omitted) will now ask or deny. That is the intended fix; review rules of that shape before deploying.
- `args.command/path/url` containing control, zero-width or direction-changing characters are refused with 422 (newline and tab allowed).
- At most 50 connected agents per workspace; 3000 agent requests/minute per workspace (both configurable or removable only in code/env as noted).
- `TEND_APP_URL` must be `https://` in production (otherwise accounts stay off, as when it is unset).
- New optional settings: `TEND_KEY_MAX_AGE_DAYS`, `TEND_WORKSPACE_RPM`.

## 9. Production requirements (values are yours to choose; none were invented or set)

1. `TEND_ADMIN_TOKEN`: 32+ random characters (the build refuses weak ones; check: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`). Set `TEND_PUBLIC=0` explicitly.
2. `DATABASE_URL`: your Postgres (pooled). Without it a non-Vercel server uses an embedded database.
3. `TEND_TRUSTED_PROXY`: the number of proxies in front. Automatic on Vercel. Verify the origin is **not** reachable around the proxy; otherwise a client can choose its own address.
4. `TEND_APP_URL=https://<your host>` (no path), `RESEND_API_KEY`, `TEND_EMAIL_FROM`. Accounts stay off until all three are set.
5. Optional: `TEND_KEY_MAX_AGE_DAYS` (for example 90), `TEND_WORKSPACE_RPM`, `TEND_AGENT_RPM`.
6. HSTS is sent by every production build (verified: `max-age=63072000; includeSubDomains`). Check it on the real domain after deploy (curl -I). The Secure/`__Host-` cookie needs the real https origin.
7. Run `npm run beta:check` (their preflight) against your real environment values; I did not run it with real values.
8. In Claude Code, enforce hooks with managed settings so a repository cannot disable them.
9. Keep an `audit-verify` checkpoint outside TEND.
10. Review the **new** CI workflow before relying on it (section 10) and add CodeQL if your repository can use it.

## 10. Test results

| Run | Result |
|---|---|
| `npm test`, clean checkout, Node 24.22 (the `.nvmrc` version) | **571 tests: 541 pass, 1 fail (V-9, environmental), 29 skipped** (24 need PostgreSQL, 5 need macOS `sandbox-exec`) |
| Real PostgreSQL 16: `postgres.test.ts` + `postgres-verify.test.ts` | **24/24 pass** (the 24 skipped above) |
| `redteam/attacks.ts` (module level) | 29 HELD, 0 BROKEN |
| Live agent-escape suite + fuzz (`run-all.mjs`) | 231 HELD, 0 BROKEN; fuzz 7 properties × 10,000 |
| Production config, DAST, hook fail-closed, MCP proxy | 8 + 5 + 11 + 13 HELD, 0 BROKEN |
| Offline end-to-end (authz 26, gateway 11, connect 8, accounts 30, open-beta 41, onboarding 38) | 154/154 |
| Real Claude Code (hooks 27, coverage 19) | 46/46; `--expiry` run: see below |
| Lint, `tsc`, production build, eslint-security, Semgrep ERROR, secretlint, `npm audit --omit=dev` | all pass |
| `e2e:cursor-hooks` | not run (Cursor's `cursor-agent` is not installed) |
| Skipped by design | macOS sandbox tests (5) |

Not run: GitHub Actions itself, OWASP ZAP, CodeQL, Snyk, OSV-Scanner, gitleaks/trufflehog, `npm audit signatures`, tests with a real Anthropic/OpenAI agent beyond Claude Code, a deployment on Vercel or any production host.

## 11. Independent review recommendations

1. A third-party penetration test of the hosted service, with the gateway and any tool you actually plan to put behind it.
2. A review of the global advisory-lock design and the tenancy model (add row-level security or per-tenant schemas if the data is sensitive).
3. A security review of the Claude Code / Cursor / MCP integrations against the hosts' own current guidance, including managed settings.
4. Run GitHub CodeQL and a full-registry Semgrep and OWASP ZAP baseline in CI, and gitleaks over the full history.
5. Decide on look-alike-character policy for names and descriptions, and on 2FA before any customer data.

## 12. Round 2 (autonomous hardening pass)

Same branch, same rules (nothing pushed or deployed). New evidence below is again self-authored unless stated.

### 12.1 Claude Code bypasses, tested against real Claude Code 2.1.327 (Haiku, harmless `echo` commands)

| Scenario | Result |
|---|---|
| Hooks installed per project, nothing else | blocked (control) |
| …plus `{"disableAllHooks": true}` in the repository's own `.claude/settings.json` | **BYPASSED: the command ran, TEND heard nothing** |
| …plus `--setting-sources user` (omits project settings) | **BYPASSED: the command ran** (new finding) |
| …plus `--dangerously-skip-permissions` | blocked: bypass mode does **not** skip hooks (docs said "untested") |
| Hooks in **managed settings** (`/etc/claude-code/managed-settings.json`, `allowManagedHooksOnly`) with: repository `disableAllHooks`, `--setting-sources user`, `--settings` file with `disableAllHooks`, `--dangerously-skip-permissions`, `--permission-mode bypassPermissions`, another `CLAUDE_CONFIG_DIR` | **all blocked** |
| Managed hooks, TEND stopped, a command the policy would allow | blocked |
| `--bare` (Claude Code's help: skips settings hooks) | **not tested**: it cannot log in with a subscription here. Treated as a bypass. |

**Fix:** `node tend-hooks.mjs install claude-code --managed --url … --yes` (administrator rights) writes the hooks, the script and the key file to Claude Code's organization settings folder, root-owned, with `allowManagedHooksOnly`; the key file is group-readable only; the hook trusts a root-owned key file only inside a root-owned folder nobody else can write (so the person, or an agent running as them, cannot repoint the hook at another server or swap the script). `status … --managed` checks it. Real-Claude-Code proof: `TEND_E2E_MANAGED=1 npm run e2e:claude-managed`, **15/15**. It writes `/etc/claude-code` and removes it again, so it only runs as root with an explicit opt-in. Unit tests: `tend-hooks.test.mjs` (managed status, refusal when not administrator).

**This does not make enforcement complete.** It closes the repository-level and flag-level bypasses that were reproduced. It does not cover `--bare`, anyone with administrator rights, a host where managed settings are not applied, or any agent that is not Claude Code or does not call TEND.

### 12.2 Other issues found and fixed

| ID | Finding | Fix and evidence |
|---|---|---|
| R2-1 | **Public by default in production** when the admin token was missing or weak (anonymous visitors could read redacted activity). | `config.public` is false in production unless `TEND_PUBLIC=1`. `config-hardening.test.ts`; `prod-config.mjs` PC-9 now asserts 401; new check DS-6 shows an anonymous visitor gets no agent name, id or key from 43 pages and data routes. |
| R2-2 | **Ambiguous argument names**: `{amount: 1, Amount: 5000}`, `"amount "`, `amount\u200b`, fullwidth, or a literal `"a.b"` next to `{a:{b}}` let a consumer read a different value than the rule. | `at()` returns UNKNOWN when two spellings coexist (stricter for deny/approve, ignored for allow). `EV-18`; new fuzz property "twin" (20,000 cases, 0 violations). |
| R2-3 | **Look-alike letters** (Cyrillic "а" in a Latin word) in the agent's description. | Refused in `detail`; flagged `⚠ mixes alphabets` in the arguments shown to the approver. `EV-19`. |
| R2-4 | **Hashed (MCP) arguments looked like content** on the approval card. | Shown as "NOT SHOWN IN FULL: N characters, fingerprint …". `EV-19`. |
| R2-5 | A long or multi-line command could hide its tail below the scroll fold. | The card states the true line and character count. `EV-21`. |
| R2-6 | **Resource limits**: quotas were per agent only. | One daily ceiling per workspace on events and authorizations (200,000 / 20,000), plus the request budget from round 1. `EV-20`. |
| R2-7 | Unhandled errors were logged as the raw error object (database detail, parameters). | `describeError`: kind, code, 300 characters, stack. `hardening.test.ts`. |
| R2-8 | Production without `DATABASE_URL` silently used the embedded database. | Loud warning (not refused: a single-machine production start stays possible). |

### 12.3 Tenant isolation, exhaustively

`redteam/live/tenant-matrix.mjs`: two real accounts on a production build; everything tenant A owns (agent and key, pending and approved authorizations, central policy, notification) is addressed through **every** route, 5 verbs, each of A's 5 object ids and 7 bodies, as B's operator, B's agent key and anonymous: **6,831 requests, no data of A returned, nothing of A changed, A's approval still spendable, no 5xx** (503 only from the push-subscription route where browser push is not configured). The isolation is still application-level (no row-level security), see section 7.

### 12.4 Results of the round-2 run (clean checkout, Node 24.22, same emulation of the CI workflow as section 10)

| Run | Result |
|---|---|
| `npm test` | **580 tests: 550 pass, 1 fail (the environmental `lsof` test, V-9), 29 skipped** (24 PostgreSQL, 5 macOS) |
| Real PostgreSQL 16 | 24/24 |
| `redteam/attacks.ts` | 29 HELD, 0 BROKEN |
| Live agent-escape suite + fuzz (8 properties × 10,000) | 231 HELD, 0 BROKEN |
| Tenant matrix / MCP proxy / production config (9) / DAST (6) / hook fail-closed (11) | all HELD |
| Offline e2e (26 + 11 + 8 + 30 + 41 + 38) | 154/154 |
| Real Claude Code: hooks 27, coverage 19, expiry 6, **managed 15** | 67/67 |
| lint, `tsc`, production build, eslint-security, Semgrep ERROR, secretlint, `npm audit --omit=dev` | pass |

Not run: GitHub Actions itself, OWASP ZAP, CodeQL, gitleaks, Snyk/OSV, Cursor, `--bare`, any real deployment.

## 13. Round 3 (database isolation review, negative controls, independent-style review)

### 13.1 The premise did not match the repository

The brief described a PostgreSQL tenant-context and RLS implementation (`db/rls/002_context_grants.up.sql`, `TEND_CONTEXT_KEY`, `docs/database-isolation.md`, "233 defenses held", "23/23 PostgreSQL"). **None of it exists in this repository**: no such file, branch, stash or commit (`git log --all -S` for the key, the migration name and `ENABLE ROW LEVEL SECURITY` find nothing). Those reported results are **NOT VERIFIED** and were not reproduced. What exists is application-level tenant isolation on one pooled owner connection. I did not build RLS (a design, not a hardening step; sketched in `docs/database-roles.md`). The context-key, "global TEMPORARY revocation" and tenant-impersonation questions are not applicable to this code.

### 13.2 Architecture and trust boundaries (what is actually here)

Browser operator (cookie session) and agent (bearer key) → Next.js route handlers → `src/server/*` → one PostgreSQL/PGlite pool, connecting as one role that also migrates. Tenant boundary: a workspace id checked in each route (`agentInWorkspace`, `reviewInWorkspace`, `centralInWorkspace`) and in each listing. Cross-tenant-by-design owner-connection paths: expiry sweeps, push queue (`flushPush`), admin user list and audit verification, rate-limit tables. Enforcement boundaries: Claude Code PreToolUse hook (before the tool), MCP proxy (before forwarding), cooperative gate (in the agent), gateway (TEND runs the tool). The database trusts the application completely.

### 13.3 Findings of this round

| ID | Finding | Severity | Status | Evidence |
|---|---|---|---|---|
| R3-1 | `since()` read up to 500 events of **every** workspace, filtered them in the application, and returned a platform-wide sequence cursor: other tenants' rows crowded a viewer's batch out (a busy tenant could hide a quiet one's events from the live feed) and the cursor disclosed the platform's write rate. No content leaked. | Low (availability/side channel) | **Fixed** | `EV-22` fails without the fix (`B's cursor (1351) must not track the platform-wide sequence (1452)`) and passes with it; negative control M-11. |
| R3-2 | The append-only trigger on `events`/`auth_events`/`verification_runs` is switched off by `set_config('tend.maintenance','on',true)`, which any session can run. So a role with `DELETE` can erase the audit log. Protection must come from privileges. | Medium (needs SQL execution in the app role; there is no known injection) | **Mitigated** (opt-in role) | `runtimeGrantsSql` + `docs/database-roles.md`; PV-5 on real PostgreSQL 16 shows the restricted role cannot DELETE/UPDATE/TRUNCATE the logs, DROP TRIGGER, ALTER/CREATE/DROP, or rewrite `schema_migrations`, while the application's flows work under it. Negative control: PV-5 fails when the revoke is removed. **Default deployments still connect as the owner and are exposed to this.** |
| R3-3 | **Found by the separate review agent, then reproduced:** with R3-2's first grants the role could still erase a victim's history, because `events` and `verification_runs` are `ON DELETE CASCADE` children of `agents`, and a cascade runs with the owner's privileges (`DELETE FROM agents` with the flag raised). | Medium | **Fixed** | `PV-7` fails without the added `REVOKE DELETE … ON agents, users, workspaces`; also asserts the owner role can still do it (contrast). |
| R3-4 | The hash-chain boundary row `meta.events.chain.v2_after` (which formula `verifyAudit` uses per row) was writable by the application role. | Low–Medium | **Fixed** | Migration 17 (additive trigger, no bypass); `PV-7`. |
| R3-5 | Start-up always migrated with the runtime role (schema-changing rights in the serving process); no way to separate them. | Low | **Fixed (opt-in)** | `DATABASE_MIGRATE_URL`; the runtime pool must find every migration applied or the start fails. `PV-6` (real PostgreSQL), `db-startup.test.ts` (4 tests: unreachable database, Vercel without database, half-configured split, outdated schema; none can fall back to the embedded database). |
| R3-6 | The tests did not show that the security checks themselves were load-bearing. | Process | **Addressed** | `redteam/mutation-controls.mjs`: 15 unit mutations and 2 route mutations; each removes one real check and the matching tests must fail. First run: **13/15 detected**; the two UNDETECTED were *equivalent mutants* (the same guarantee is enforced twice: expiry sweep + spend clause; status check + SQL guard). They were re-run as double mutations after adding `EV-23` (decisions are final): **detected**. Final: **15/15** unit, **2/2** routes (removing the workspace check in the reviews route or the agent-keys route makes the tenant matrix fail). Not run in CI (it rewrites sources). |
| R3-7 | Flaky tests under load: `open-beta-e2e` waits 3 s for the verification mail and fails 3 checks when the machine is busy (seen once while other jobs ran; 41/41 twice on a quiet machine and in the final run). | Test robustness | **Not changed** | Not a security failure. |

Reviewer findings **not** acted on: advisory-lock denial of service (documented; privileges cannot prevent it), PG ≤14 `PUBLIC CREATE` (documented minimum version), grants not covering later tables (documented), `assertSchemaCurrent` reads versions not privileges (comment corrected).

### 13.4 Review by a separate agent

A second model session, given no access to my conclusions, read the diff and the SQL paths (read-only). It found R3-3 (real) and the documentation overclaims above, and checked that the event-feed scoping, the grants and `open()` fail-closed behaviour were sound. **This is a second look by another AI session, not an external audit**, and it did not run tests or review every route.

### 13.5 Tests actually executed in this round (clean checkout, Node 24.22)

| Run | Result |
|---|---|
| `npm test` | **589 tests: 556 pass, 1 fail, 32 skipped.** The one failure is the `lsof` test (V-9, environmental); skips: 27 PostgreSQL tests that run separately, 5 macOS-only. |
| Real PostgreSQL 16 (`postgres.test.ts` 20 + `postgres-verify.test.ts` 7) | **27/27** (includes PV-5, PV-6, PV-7) |
| Tenant matrix (B's operator and agent key, platform admin, anonymous; 34 routes × 5 verbs × 5 object ids × bodies) | **9,108 requests, no data of A returned, nothing changed** |
| `redteam/attacks.ts` / live suite + fuzz / production config / DAST / hook fail-closed / MCP proxy | 29 held / 231 held / 9 / 6 / 11 / 13 held, 0 broken |
| Offline e2e | 26 + 11 + 8 + 30 + 41 + 38 = **154/154** |
| Real Claude Code 2.1.327: hooks, coverage, managed | **27/27, 19/19, 15/15** (the 10-minute `--expiry` run was not repeated this round; last result 6/6 on the previous commit) |
| Lint, `tsc`, production build, eslint-security, Semgrep ERROR, secretlint, `npm audit --omit=dev` | pass |
| Mutation controls | 15/15 unit, 2/2 routes |

### 13.6 Real agent actions: blocked before execution?

For **Claude Code through the hooks**: yes, shown by what the tool left behind, not by a dashboard event (each test command writes a file; the file must not exist), with real Claude Code 2.1.327 and its real model, including when TEND is stopped, when the key is revoked, after expiry, and (managed install) against project `disableAllHooks`, `--setting-sources user`, `--settings`, bypass-permissions mode and another config directory. **Cursor** is not installed here: BLOCKED, untested. For the **MCP proxy** the example server's ledger proves the tool never ran. For the **built-in gateway** TEND itself runs only harmless demo tools. The scripted tests (gate tests, e2e with a fake model) prove protocol behaviour, not host behaviour. Still unprotected: `--bare` mode (untested), administrator rights, agents that do not call TEND.

### 13.7 Production readiness blockers (unchanged in kind)

No row-level security and no tenant context in the database; the default deployment connects as the owner (R3-2); no 2FA/SSO/roles; no external penetration test; GitHub Actions never run; OWASP ZAP/CodeQL/gitleaks not run; no production-equivalent deployment tested; `--bare` and Cursor untested.

### 13.8 Recommended independent audit scope

Tenant isolation design (RLS vs. per-tenant schemas) and every owner-connection path; the global write lock; the restricted-role grants on your actual PostgreSQL version and provider (Neon's pooler behaviour for `SET LOCAL`); the managed-hooks deployment on your fleet; the hosted service's proxy/TLS setup.

## 14. Round 4: database-enforced tenant isolation (row-level security)

Commits `e848b71..e845057` (6 commits after `bfdcd7f`), 32 files. Nothing pushed or deployed. All evidence below is self-produced on this machine: PostgreSQL 16 locally, real Claude Code 2.1.327, and two read-only AI review sessions. **None of it is an external audit or penetration test.**

### 14.1 Baseline at the start of this round

- Tenant isolation was application-level only.
- The default deployment ran every query as the schema owner.
- The restricted role was opt-in.
- Earlier claims of an RLS/"context key" implementation had no code behind them (section 13.1).

### 14.2 Threat model (short)

| Threat | Main control | Database control now | Residual |
|---|---|---|---|
| Tenant A reads or changes B's data through a bug in a route or a query (IDOR, missing filter) | workspace checks in routes | **RLS on 16 tables, fail closed** | none found (see 14.4) |
| SQL injection in the application's session | parameterised queries everywhere (reviewed) | restricted role: no DDL, no log tampering | **the attacker can set the tenant settings** (RLS-6); with an owner login, can also `RESET ROLE` (RLS-5) |
| Stolen agent key | revocation, optional expiry, per-workspace quotas | RLS confines it to its workspace | the key acts as the agent until revoked |
| Malicious tool or agent | only paths that ask TEND are governed (hooks, MCP proxy, gateway) | — | unintegrated agents, `--bare`, administrator rights (14.6) |
| Audit tampering | hash chain + checkpoint; append-only trigger | restricted role has no UPDATE/DELETE/TRUNCATE on logs, no cascade path, chain-boundary row immutable | the database owner can rewrite history; keep the checkpoint outside |
| Database credential compromise | — | — | the owner credential defeats everything in the database; the restricted login (split) limits a leaked runtime credential |

### 14.3 Implemented controls (file paths)

**Policies** (`src/server/db.ts`, migration 18):
- Row-level security on `workspaces`, `agents`, `central_policies`, `users`, `notifications`, `events`, `reviews`, `asks`, `authorizations`, `verification_runs`, `operator_sessions`, `auth_events`, `user_tokens`, `onboarding`, `push_subscriptions` and `notification_prefs`.
- Each table has one `FOR ALL` policy with the same `USING` and `WITH CHECK`, so rows cannot be read across tenants, written across tenants, or moved between them.
- Not covered by RLS, on purpose: `rate_limits`, `meta` (its chain row is protected by trigger) and `schema_migrations` (read-only to the runtime role).

**Tenant context** (`src/server/db-context.ts`):
- Every route and the two database-reading server pages start with an empty context.
- `requireOperator` binds the session's workspace and `authAgent` binds the key's workspace, both from server-side rows.
- Nothing tenant-scoped is visible before binding.
- Binding a second, different workspace in one request is refused.
- One process-wide store: Next.js puts pages and route handlers in separate module graphs. With a per-module store, the page could set a context the driver never saw; the e2e suite found this.

**Transaction scope** (`postgres()` in `db.ts`):
- Every transaction starts with `SET LOCAL ROLE <runtime role>` and `set_config(…, true)`.
- A statement outside a transaction becomes one.
- Nothing survives on a pooled connection, which is safe with PgBouncer transaction pooling (RLS-4).

**Runtime role by default** (`enableIsolation`):
- With an owner login, start-up creates the NOLOGIN role `tend_runtime` with least-privilege grants, under an advisory lock.
- Every transaction switches to it. A restricted login (`DATABASE_MIGRATE_URL` split) is used as is.

**Start-up self-test.** The server refuses to start ("fail closed") if any of these holds:
- the effective role is a superuser or has `BYPASSRLS`;
- it owns, or is a member of a role that owns, any table;
- any `RLS_TABLES` table lacks RLS;
- any tenant table carries a policy that is not ours.

**On by default** in production on PostgreSQL (`TEND_DB_ISOLATION`). Off only explicitly, with a warning.

**Explicit cross-tenant paths** (`grep -rn "asSystem\|asOwner" src`):
- session and key lookup before authentication;
- account sign-up, sign-in and reset;
- the platform admin's routes (`requireAdmin`);
- the push queue;
- moving a push subscription, which now requires the same browser keys;
- demo maintenance (`asOwner`).

**Audit chain under RLS:** the chain trigger runs `SECURITY DEFINER` with a pinned `search_path` (migration 19), so it links to the global head.

### 14.4 Vulnerabilities found in this round and fixed

| ID | Finding | Found by | Severity | Status | Evidence |
|---|---|---|---|---|---|
| R4-1 | No database-enforced isolation; owner role at runtime by default | baseline | High (defence in depth) | **Fixed** (14.3) | RLS-1…8; route mutations M-R1/M-R2 below |
| R4-2 | My first RLS version broke the global audit hash chain: the trigger saw only the inserting tenant's events | AI review #2 | High (integrity) | **Fixed** | RLS-7 failed before migration 19, passes after |
| R4-3 | The self-test missed owner rights obtained through role membership, and permissive policies added later | AI review #2 | Medium | **Fixed** | RLS-8 (refuses a member-of-owner login and a `USING (true)` policy) |
| R4-4 | Knowing a browser's push endpoint URL let another account take that browser's notifications (pre-existing) | AI review #2 | Low | **Fixed** | EV-24 |
| R4-5 | The context store was duplicated across Next.js bundles; the Home page saw no rows | e2e on PostgreSQL | Functional (failed closed) | **Fixed** | e2e:onboarding 34/38 before, 38/38 after |
| R4-6 | Demo reset returned 500 under the restricted role | tenant matrix on PostgreSQL | Functional | **Fixed** (409, or owner when available) | tenant matrix on PostgreSQL |
| R4-7 | Concurrent cold starts could race on CREATE ROLE and GRANT | AI review #2 | Low | **Fixed** (advisory lock) | code; not load-tested |
| R4-8 | Flaky e2e: 3 s mail wait; connect-e2e picked one of 9 fixed ports | test runs | Test | **Fixed** | full runs |
| R4-9 | mutation-controls ignored a failing build | AI review #2 | Test | **Fixed** | code |

### 14.5 Tests executed (exact results)

| Command | Result |
|---|---|
| `npm test` (clean checkout, Node 24.22) | **598 tests: 557 pass, 1 fail, 40 skipped.** The fail is the `lsof` test, environmental (V-9). The skips are 35 PostgreSQL tests run separately below and 5 macOS-only. |
| `TEND_TEST_DATABASE_URL=… node --test src/server/postgres.test.ts src/server/postgres-verify.test.ts src/server/rls.test.ts` | **35/35** (20 + 7 + 8) |
| `TEND_E2E_DATABASE_URL=… npm run e2e:{authz,gateway,connect,accounts,open-beta,onboarding}`, RLS on | **154/154**. connect-e2e always uses the embedded database, so it is not an RLS result. |
| Same, embedded database | 154/154 |
| `TEND_E2E_DATABASE_URL=… node redteam/live/tenant-matrix.mjs` | 9,108 requests, HELD |
| `TEND_E2E_DATABASE_URL=… node redteam/mutation-controls.mjs --routes` | **M-R1, M-R2 DETECTED-AND-HELD**: workspace check removed from the reviews and agent-keys routes, tenant matrix still holds through RLS. On the embedded database (no RLS) the same mutations are breaches. |
| On PostgreSQL: run-all / dynamic scan / MCP proxy / hook fail-closed | 230 held / 6 / 13 / 11, 0 broken. run-all held 231 on the embedded database; the one-check difference was not investigated. |
| Real Claude Code 2.1.327: hooks / coverage / managed (embedded); hooks on PostgreSQL with RLS | 27/27, 19/19, 15/15; **27/27 on PostgreSQL** |
| `node redteam/mutation-controls.mjs` (unit) | see 14.9 |
| Lint (1 warning, in a non-project skill file), `tsc`, production build, eslint-security, Semgrep ERROR rules, secretlint, `npm audit --omit=dev` | pass |

### 14.6 Pre-execution blocking: evidence and its limits

- **Claude Code (hooks):** the blocked command's output file never appears. Shown with real Claude Code against both the embedded database and PostgreSQL with RLS, with TEND stopped, after expiry (10-minute run, previous round) and with a revoked key.
- **Managed install:** survives project `disableAllHooks`, `--setting-sources user`, a `--settings` file, bypass-permissions mode and another config directory.
- **MCP proxy:** the example server's ledger has no line for a denied call.

**Not protected:**
- Claude Code `--bare` (untested; treat it as a bypass);
- per-project hooks against `disableAllHooks` or `--setting-sources user` (reproduced);
- Cursor (not installed: NOT VERIFIED);
- any agent that does not call TEND;
- anyone with administrator rights on the machine.

### 14.7 Database isolation: guarantees and exceptions

**Guaranteed** (tested on PostgreSQL 16 locally), with isolation on and the self-test passing: a request bound to workspace A cannot read, update, delete or insert rows of workspace B in the 16 tables, whatever query the application runs (RLS-2, M-R1/M-R2). A request with no tenant sees nothing tenant-scoped (RLS-3). Context never leaks between requests on pooled connections (RLS-4).

**Exceptions:**
1. The explicit `asSystem` and `asOwner` paths in 14.3.
2. SQL injection can set `tend.system` or `tend.workspace` (RLS-6). With an owner login it can also `RESET ROLE` (RLS-5). A signed, transaction-bound context verified by a `SECURITY DEFINER` function would close this; **not implemented**.
3. The embedded database (development) has no RLS.
4. `rate_limits` and `meta` are global.
5. Visitors of a public instance see the default workspace; hiding private agents there is still the application's filter.

**NOT VERIFIED:**
- Neon itself (PgBouncer transaction pooling, `CREATE ROLE` by `neondb_owner`). A non-superuser owner with CREATEROLE was emulated locally (RLS-8).
- Vercel cold starts.
- Performance of the `EXISTS` policies on large `events` tables.

### 14.8 Authentication and access control

- **Reviewed this round:** session lookup, agent keys and admin binding as part of the context work. No new findings beyond R4-4.
- **Role model: not implemented.** Workspaces have exactly one account, so roles inside a workspace have nothing to act on yet. The design that fits:
  - workspace memberships `(user, workspace, role ∈ owner | approver | viewer)`;
  - `requireOperator(req, db, need)` checks the role;
  - RLS stays per workspace.
- **MFA/SSO: not implemented.** Use maintained libraries, not custom crypto: WebAuthn/passkeys via a maintained WebAuthn server library, and OIDC SSO via a certified OIDC client. Both are blockers for production with real customers.

### 14.9 Negative controls

Unit mutations on the final tree: see the appended line below. Route mutations: DETECTED on embedded (round 3), DETECTED-AND-HELD on PostgreSQL with RLS (this round).

### 14.10 Production blockers

1. Verify on the real stack: Neon pooled URL, role creation by the Neon owner, Vercel cold starts with `TEND_DB_ISOLATION` on. It refuses to start if isolation cannot be guaranteed, so do this on a preview deployment first, or set `TEND_DB_ISOLATION=off` and accept application-level isolation only.
2. SQL-injection-resistant tenant context (signed context), or a restricted login (`DATABASE_MIGRATE_URL`) at minimum.
3. MFA/SSO and a role model.
4. GitHub Actions never run; CodeQL, OWASP ZAP and gitleaks never run (NOT VERIFIED: no Docker daemon, binary downloads blocked here).
5. External penetration test.
6. Cursor and `--bare` untested.

### 14.11 Verdict

**CONTROLLED BETA.** Database isolation is now real and tested locally, the enforcement paths that exist block before execution, and the remaining gaps are documented. It is not a PRODUCTION CANDIDATE: blockers 1–5 above, and none of this has been checked by an independent human.

Result of `node redteam/mutation-controls.mjs` on commit e845057: **15/15 unit mutations detected** (M-01…M-15).

## 15. Round 5: toward enterprise readiness (database hardening, operations, adversarial review)

Branch `security/verification`, commits `420d2b2`…`67f11af` (local, not pushed). Everything below ran in this container on PostgreSQL 16 and
Node 22 unless stated. **No independent human reviewed any of it.**

### 15.1 Changes

| Commit | Change | Evidence |
|---|---|---|
| 420d2b2 | **Signed tenant context** (migration 20): per-transaction nonce + MAC from an owner-only key (`TEND_CONTEXT_KEY`); policies trust the context only if `tend_ctx_valid()` (SECURITY DEFINER) verifies it; start-up refuses a key the database lacks | RLS-9 incl. negative control (no key installed → the forgery reads everything again) |
| 2d8bef0 | Policies evaluated once per statement (initplans, migration 21) | `redteam/bench/rls-bench.mjs`: 12k–20k events, 242–601 ms → 17–25 ms; signing adds < 2 ms |
| 79bd508 | `SECURITY.md`, `docs/operations.md` (responsibilities, secret rotation, backups, monitoring signals, vulnerability management), `docs/incident-response.md`; two drills | drills below |
| 2088c45 | **R5-1 fixed:** the signed context expires (migration 22, 60 s window, issue time inside the MAC); start-up reports clock skew | RLS-10; mutation M-16 detected |
| d518b40 | **R5-2 fixed:** every isolated transaction pins `search_path = public, pg_temp` | RLS-11; mutation M-17 detected |
| 910b0d9 | CI: M-16/M-17 and both drills added to the PostgreSQL job | **not run on GitHub** |
| 67f11af | Red-team suite fixes: R5-3, R5-4 | run-all 231/231 on both databases |

### 15.2 Findings of this round (internal adversarial review, by me, of my own round-4/5 code)

| ID | Finding | Severity | Status |
|---|---|---|---|
| R5-1 | A signed context was valid forever. SQL injected into a *system* transaction (session lookup, sign-in) could read `tend.ctx_nonce/kid/mac` and replay them in any later transaction to read every tenant. Reproduced: a context signed 10 minutes earlier read both tenants. | High (requires SQL injection and a restricted login, the exact case the signing exists for) | Fixed: replay now possible only within 60 s. **Residual, documented.** |
| R5-2 | Under a restricted login with signing on, injected SQL in tenant A's request could `CREATE TEMP TABLE agents` (PUBLIC holds TEMP) with A's row moved to workspace B. Temp tables outlive the transaction on a pooled connection and `pg_temp` is searched first, so later **A's own agent key authenticated into workspace B**. Reproduced end to end. | High (same precondition) | Fixed: `SET LOCAL search_path = public, pg_temp` in every transaction preamble; RLS-11 fails without it |
| R5-3 | Red-team check I-11 was flaky: the "mutated" key equalled the real key when it ended in `A` (1 in 64) | Test | Fixed |
| R5-4 | The unexplained run-all 230 vs 231: W-30 recorded INFO on PostgreSQL because `/api/health` adds `tls` there (by design) | Test | Explained and fixed |

Also reviewed with no finding: trigger functions (read no tables), `events_chain` (own `search_path`), context functions (functions are never
resolved from `pg_temp`), named prepared statements (none), session-level `set_config`/`SET ROLE` by injected SQL (overridden per transaction).

### 15.3 Tests executed on the final tree (exact results)

| Command | Result |
|---|---|
| `npm test` | 557 pass, 1 fail (the `lsof` test V-9; fails identically with the changes stashed) |
| PostgreSQL: `postgres.test.ts` + `postgres-verify.test.ts` + `rls.test.ts` | **38/38** (RLS-1…11) |
| Mutation controls, unit (`TEND_TEST_DATABASE_URL` set) | **16/16 detected** (M-01…M-16, before d518b40); `--only=M-16,M-17` on the final tree: **2/2** |
| e2e on PostgreSQL, RLS on, **signed context**: authz / gateway / accounts / open-beta / onboarding / connect | 26 / 11 / 30 / 41 / 38 / 8, all pass |
| Tenant matrix (9,108 requests), MCP proxy, hook fail-closed, dynamic scan, on PostgreSQL + signing | HELD / 13 held / 11 held / 6 held, 0 broken |
| `run-all` | **231 held, 0 broken** on PostgreSQL + signing and on the embedded database |
| Real Claude Code 2.1.329: hooks on PostgreSQL + signing / coverage / managed install | **27/27 / 19/19 / 15/15** |
| `scripts/ops/backup-restore-drill.mjs` | 8/8: dump 72 KB in 56 ms, restore 124 ms; restored log verifies against the pre-dump checkpoint; isolation starts with the same key; agent keys and approvals work on the copy; a deleted prefix on the copy is missed by a bare walk and caught by the checkpoint |
| `scripts/ops/context-key-rotation-drill.mjs` | 6/6: two keys valid during rollout; old key fails closed once removed; an uninstalled key sees nothing |
| `tsc`, eslint on changed files, production build | pass |

**NOT VERIFIED:** GitHub Actions (never run); Neon (pooler, role creation, clock skew to the app servers); Vercel cold starts; provider
point-in-time recovery; restore at production size; CodeQL, DAST (ZAP), git-history secret scan (none configured); Cursor; Claude Code `--bare`.

### 15.4 Score

**6 / 10 for enterprise readiness, plausible range 5–7.** This is my own assessment of my own work, made with AI-run tests only. It is not a
certification.

| Area | Score | Why |
|---|---|---|
| Database security | 7 | RLS on 16 tables, least privilege, signed and expiring context, search_path pinned, all with negative controls. But only local PostgreSQL. The default single-URL deployment logs in as the owner, where `RESET ROLE` escapes RLS (RLS-5) and signing does nothing. |
| Agent enforcement | 7 | Blocks before execution in real Claude Code, also in managed mode. Still bypassable by agents that don't call TEND, by `--bare` (untested), and by local admins. |
| Authentication | 4 | Passwords, sessions and expiring keys are tested. **No MFA, no SSO, no roles.** |
| API security | 7 | Tenant matrix, fuzzing, rate limits, argument binding. No external test. |
| Audit integrity | 7 | Append-only, hash chain, checkpoint (also across a restore). Checkpoints are kept by hand, with no external anchoring. |
| Infrastructure | 5 | Secrets and rotation are documented and two drills pass. No built-in monitoring or alerting. Nothing verified on the real hosting. |
| Security testing | 6 | Broad suites with mutation controls. CI has never run. No CodeQL or DAST. **No independent penetration test.** |
| Operational readiness | 4 | Runbooks exist, but owners are blank, no exercise has been run and there is no on-call. |

### 15.5 What stands between this and 9/10, in priority order

1. **Independent human review:** an external penetration test of tenant isolation, authentication and the enforcement paths (scope in 13.8). No amount of AI testing replaces it.
2. **MFA (WebAuthn/TOTP) and SSO (OIDC), plus workspace roles** (owner / approver / viewer). Use maintained libraries.
3. **Production-equivalent validation:** a Vercel preview on Neon with `DATABASE_MIGRATE_URL` + restricted login + `TEND_CONTEXT_KEY`, then the e2e suites, the tenant matrix and both drills against it. Make the restricted login the documented default.
4. **Run CI on GitHub and keep it green.** Add CodeQL, a ZAP baseline against the preview and a git-history secret scan.
5. **Monitoring and alerting** on the signals in `docs/operations.md`, plus scheduled `audit-verify` against a checkpoint stored outside the database.
6. **Operations:** name owners, run a tabletop incident and a restore on the hosted database, and publish a security contact.
7. Cursor and `--bare` testing. Per-tenant advisory locks (today one role can stall writes for everyone).

### 15.6 Verdict

**CONTROLLED BETA** (unchanged). The database layer is stronger and two real high-severity weaknesses in my own previous round were found and
fixed, but blockers 1–4 above keep this from being a PRODUCTION CANDIDATE.

## 16. Round 6: enterprise security phase 3

Branch `security/verification`, commits `94fb548`…`5ba164c` on top of `185fbcd` (local, **not pushed**). Everything ran in this container:
PostgreSQL 16.15, Node 22, Chromium (Playwright 1.63), Claude Code 2.1.329. Labels: **VERIFIED** (tested here, evidence named),
**IMPLEMENTED BUT UNVERIFIED**, **NOT IMPLEMENTED**, **BLOCKED**, **FAILED**. No independent human reviewed any of it; the review in 16.3
is an AI review.

### 16.1 Implemented controls

| Control | Status | Evidence |
|---|---|---|
| Signed tenant context **bound to its transaction** (backend pid + start time; migration 23). The 60 s replay window is gone. | VERIFIED | RLS-10 (a capture replayed in the next transaction is refused; forged bindings refused); M-16 |
| Production refuses a database login that can regain owner or privileged rights; requires `TEND_CONTEXT_KEY`; the runtime role may not create temp tables (`TEND_DB_STRICT`; `TEND_DB_ALLOW_OWNER_LOGIN=1` is the only, logged, exception) | VERIFIED | RLS-12 with distinct roles and a Neon-style non-superuser owner; M-18 |
| Owner migrates and grants the restricted login at every start; `TEMPORARY` revoked from `PUBLIC` | VERIFIED | PV-6, RLS-12; every e2e server now runs as a restricted login |
| Pooled connections cleaned after every transaction (`pg_advisory_unlock_all()`, `RESET ALL`; `BEGIN READ WRITE`) | VERIFIED | RLS-13 (injected session locks and settings gone; other tenants' writes not stalled); M-23 |
| Self-test also refuses: log-table write rights (stray grant, `pg_write_all_data`), schema/context-function ownership, server-file roles | VERIFIED | RLS-13 |
| Workspace roles owner/admin/operator/viewer, server-side on every operator route | VERIFIED | RBAC-1…6, `routes.test.ts` (every route declares its need), `rbac-matrix` 36/36 on PostgreSQL; M-19, M-20 |
| Invitations as records of their own (migration 26) | VERIFIED | RBAC-2, RB-19/RB-20 |
| Two-step sign-in (TOTP via otplib 13.6.0), encrypted secrets, replay refusal, recovery codes, lockout, admin reset, mails | VERIFIED locally | MFA-1…6 (RFC 6238 vectors; independent reference), `mfa-e2e` 9/9 in Chromium on PostgreSQL; M-21, M-22 |
| SSO | NOT IMPLEMENTED | design only, `docs/authentication.md` |
| Security events (redacted) and 9 alert rules, webhook delivery | VERIFIED locally | MON-1…4, `alerts-e2e` (one alert from 30 real failed sign-ins, no PII) |
| Delivery to a real paging/chat service | NOT VERIFIED | — |
| Production preflight (`scripts/check-production-config.mjs`, no values printed) | VERIFIED | PROD-1/2 |
| CodeQL, gitleaks (history), ZAP baseline, Dependabot, least-privilege workflow permissions | IMPLEMENTED BUT UNVERIFIED | never run on GitHub; no Docker here |
| Merge protection | BLOCKED | repository settings need an admin (steps in `docs/ci.md`) |

### 16.2 Vulnerabilities found this round and fixed

| ID | Finding | Found by | Severity | Status |
|---|---|---|---|---|
| R6-1 | 60 s replay window of the signed context (R5-1 residual) | carried over | Medium | Fixed: transaction binding (RLS-10) |
| R6-2 | Single owner URL in production: RLS bypassable by `RESET ROLE` (RLS-5) | carried over | High | Fixed by default: refused unless explicitly accepted (RLS-12) |
| R6-3 | DB-1: session-level advisory lock by injected SQL stalls every tenant's writes; session settings persist on pooled connections | AI review | Medium | Fixed (RLS-13, M-23) |
| R6-4 | MFA-1: enabling two-step needed no password, so a stolen session could lock the owner out | AI review | Medium | Fixed: password required, mails, admin reset (MFA-6) |
| R6-5 | INV-1: invitations created real accounts, so they could pre-claim or permanently block an address; 409 revealed accounts | AI review | Medium | Fixed: separate invitation records, neutral answers (RBAC-2) |
| R6-6 | MFA-2: unlimited slow code guessing (20/hour forever) | AI review | Low | Fixed: locked after 10 wrong codes a day until password reset |
| R6-7 | MON-1/2: denial alerts keyed on a constant; a flood could wipe counters; MFA rule above the budget | AI review | Low | Fixed: per session/agent, LRU eviction, threshold 3 |
| R6-8 | DB-2: owner-login exception also silently dropped the key and TEMP requirements | AI review | Low | Fixed |
| R6-9 | DB-3: self-test missed log-write rights, schema/function ownership, server-file roles | AI review | Low | Fixed (RLS-13) |
| R6-10 | RBAC-1: viewers could mark all notifications read and push to all members; protection results needed only view | AI review | Low | Fixed: operator |
| R6-11 | CI-1: ZAP job ignored warnings | AI review | Low | Fixed; image tag still floating (documented) |
| R6-12 | My first per-account alert rule lumped unknown accounts together | own test | Low | Fixed before commit |
| R6-13 | Test harness: run-all hung (server blocked writing to an undrained pipe once security logs grew) | final run | Test | Fixed: servers log to a file |
| R6-14 | Two tests could build the real key when "mutating" it (1 in 64) | final run | Test | Fixed |

### 16.3 Adversarial review

A separate read-only agent reviewed `185fbcd..HEAD` (code read from git). It reported 9 findings from reading the code (5 medium, 4 low; none
critical or high) and 2 plausible ones. All were fixed (R6-3…R6-11) and each has a regression test. Its "checked and found sound" list covers
the transaction binding, the self-test semantics, RBAC route needs, MFA flows and the CI triggers. This is an AI review, **not** an
independent penetration test.

### 16.4 Verification on the final tree (`5ba164c`)

| Command | Result |
|---|---|
| `npm test` | 577 tests: **576 pass, 1 FAILED**: the `lsof` port-ownership test (environmental; same before this round) |
| PostgreSQL: `rls` + `postgres-verify` + `postgres` tests | **40/40** (RLS-1…13, PV-1…7) |
| Mutation controls | DB **4/4** (M-16, M-17, M-18, M-23); roles/MFA **4/4** (M-19…M-22); M-01…M-15 last run in round 5 (16/16); route mutations not re-run this round |
| e2e on PostgreSQL, **production default** (restricted login, signed): authz/gateway/connect/accounts/open-beta/onboarding | 26/11/8/30/41/38, all pass |
| e2e on PostgreSQL, legacy owner login | all pass, except **gateway: 1 FAILED run** (a 401 during setup, cause unknown); passed in 2 re-runs. Reported as a flake, not explained |
| Tenant matrix | **9,752 requests** (36 routes), HELD |
| Role matrix / MFA browser e2e / alert delivery e2e | 36/36 / 9/9 / 3/3 |
| run-all (embedded and PostgreSQL) | **231 held, 0 broken** after R6-13; before that fix, phase2 hung (FAILED) on both |
| MCP proxy / hook fail-closed / dynamic scan | held / 11 held / held |
| Backup-restore drill / key-rotation drill | 8/8 / 6/6 |
| Real Claude Code 2.1.329: hooks on PostgreSQL / coverage / managed | **27/27 / 19/19 / 15/15** |
| `tsc`, lint, `npm audit --omit=dev` | pass, pass, 0 vulnerabilities (12 moderate in dev-only tooling, unchanged) |
| Performance (`rls-bench`, local) | 12k-row tenant query 19.5 ms (before: 19.2). Small signed transaction **0.42 ms vs 0.29 ms** before this round (binding round trip + session cleanup); at 8 concurrent 0.15 vs 0.10 ms. On a hosted database add about one network round trip per signed transaction (not measured) |

### 16.5 Remaining vulnerabilities and limits

- **High (operational):** nothing verified on Vercel or Neon. **The live deployment will refuse to start on its next deploy** until it has a
  restricted login (`docs/deployment-checklist.md`) or the explicit `TEND_DB_ALLOW_OWNER_LOGIN=1`.
- **Medium:** SQL injection under the restricted login still acts as the current tenant, with its privileges, inside its own transaction.
  Parameterised queries are the only defence there.
- **Medium:** the platform admin is one shared token, with no second factor. There is no SSO.
- **Medium:** alert counters are per instance, so a distributed attack may stay under them.
- **Low:** per-user rows inside a workspace are separated by the application, not by RLS. Members are managed through the API only.
- **Low:** `REVOKE TEMPORARY … FROM PUBLIC` affects other applications that share the database.
- **Low:** the second-factor lockout uses a fixed daily window (about 18 guesses at worst across midnight).
- **Supply chain:** actions are pinned by tag, not commit SHA. The ZAP image tag floats.
- **Unsupported integrations:**
  - Claude Code `--bare`: untested, treat it as a bypass.
  - Per-project hooks: bypassed by `disableAllHooks` or `--setting-sources user` (the managed install is not).
  - Cursor: NOT VERIFIED (not installed).
  - Any agent that does not call TEND.
  - Local administrators.

### 16.6 Production blockers

1. An independent penetration test (scope: 13.8, plus RBAC and two-step sign-in).
2. A preview on Vercel and Neon through `docs/deployment-checklist.md`, with the suites run against it.
3. CI actually running green on GitHub, with merge protection on.
4. SSO, and a second factor for the platform admin (or the admin token disabled in production).
5. Alert delivery to a real paging service, and alerts across instances (log platform).
6. Named owners and a rehearsed incident (`docs/operations.md`).

### 16.7 Score

**7 / 10, plausible range 6.5–7.5.** This is my own assessment, from AI-run tests on one machine, and it is **not** a certification.

Up from 6:
- The database layer now holds against SQL injection under the production default, tested with distinct roles.
- Roles and two-step sign-in exist and are tested over HTTP and in a browser.
- Monitoring exists.
- An adversarial review's findings were fixed with regression tests.

Not 8, because:
- nothing ran on the real hosting stack;
- CI and its scanners never ran;
- there is no SSO, and the admin token has no second factor;
- there is no human review.

Verdict: **CONTROLLED BETA** (unchanged).

## 17. Round 7: CodeQL and ZAP findings, security headers, agent-key transport

Scope: every CodeQL result and every OWASP ZAP baseline warning on `security/verification`, the response headers, and how agent keys travel.
All of it was done and tested by me (an AI assistant). It is **not** an external review or penetration test.

### 17.1 Findings resolved

| # | Source | Finding | Fix | Evidence |
| --- | --- | --- | --- | --- |
| 1 | CodeQL `js/file-system-race` (**high**, 7.7) | `examples/hooks/tend-hooks.mjs`: the installer checked, read and then rewrote the host's settings file by path, so the file could be swapped between those steps (for example, for a link to another file). | The file is opened once with `O_NOFOLLOW`, then read, truncated, written, chowned and chmodded through that descriptor. A new file is created with `O_EXCL`, and the backup is written with `O_NOFOLLOW`. A settings file that is a symbolic link is refused. | The CodeQL run on `59398e5` no longer reports it (24 results, down from 26). A test shows the previous code wrote through a planted link and the new code refuses it (negative control run). |
| 2 | Review of the same pattern (found while fixing 1) | Same file: the agent key file and the installed script were written with `writeFileSync`/`copyFileSync`/`chmodSync`/`chownSync` by path, all following links. A link planted where the key file goes would have received the agent key; in a managed (administrator) install, a root-owned write could be redirected. `readConfig` ran `lstat` and then read by path. | Both files are written through one descriptor that is not a link (`O_NOFOLLOW`, `fchown`, `fchmod`). Managed folders that are links are refused. `readConfig` checks the owner and mode with `fstat` on the descriptor it then reads. | Test: a link at the key file's place is refused and its target is untouched (the previous code wrote the key into it, negative control). The key file is 0600. `claude-hooks-e2e` 27/27, `claude-managed-e2e` (as root) 15/15, `claude-coverage-e2e` 19/19. |
| 3 | CodeQL `js/file-system-race` (7.7) | `scripts/beta-local.mjs` (a file holding an admin token), `scripts/real-agent-setup.mjs` (a temporary key file and a sandbox file), `scripts/tester-export.mjs` (secret scan), `scripts/verify-integrations.mjs`: check-then-use on files. | Secrets files are created new (`O_EXCL` or `wx`) and private from the start through one descriptor. The export opens each file once without following links and scans through that descriptor. There is no separate exists check before reading. | `beta-local`, `tester-kit`, `agent-keys` and `db-tls` tests pass. CodeQL re-run: §17.4. |
| 4 | CodeQL `js/incomplete-sanitization` (7.8) | `quickstart.test.mjs:85`: a regular expression built from a version string escaped only dots. | All regex special characters are escaped. (The inputs were constants in a test, so this was never exploitable.) | Test passes. |
| 5 | Requirement 8 | Agent keys could be sent over plain http to another computer: the SDK and the example agents accepted any `http://` address, and the hooks adapter only checked at install time. | Every client (the JS SDK `connectTend`, the Python `Gate`, both example agents, and the hooks adapter at run time) refuses an http address other than `localhost`/`127.0.0.1`/`[::1]` before sending anything. The hooks then deny the tool call (fail closed). | Tests in `tend-hooks.test.mjs`, `quickstart.test.mjs` (JS and Python) and `gate.test.mjs` assert that nothing is sent. The SDK's public interface is unchanged; https and localhost http keep working. |
| 6 | ZAP 10038, 10055 (CSP) | Style elements were allowed with `'unsafe-inline'`, and the stylesheet was inlined without a nonce. | `style-src`/`style-src-elem`: the request's nonce plus two exact SHA-256 hashes (the toast library's runtime CSS and the empty string). `'unsafe-inline'` remains **only** for `style-src-attr` (React's server-rendered `style=""` attributes, which cannot load anything or run script). The stylesheet is no longer inlined. Scripts were already strict: nonce plus `'strict-dynamic'`, no `'unsafe-inline'` or `'unsafe-eval'` in production. | ZAP 10038/10055 PASS. `csp.test.ts` recomputes the library hash from `node_modules`, so an upgrade fails the test. `redteam/live/csp-browser.mjs` in Chromium: 12 pages signed out and in, 0 violations, styles applied, 5/5. Negative control: with the hashes removed, 2 FAIL. It now also runs on CI. |
| 7 | ZAP 90004 (Spectre site isolation) | No COEP/CORP. | `Cross-Origin-Embedder-Policy: require-corp` and `Cross-Origin-Resource-Policy: same-origin` on every response. COOP `same-origin` was already set. | ZAP 90004 PASS. The browser test shows nothing the app loads is blocked. |
| 8 | ZAP 10019 (Content-Type missing) | Next's trailing-slash 308 had no Content-Type. | `src/proxy.ts` sends the redirect itself (absolute same-site location, `text/plain`); `skipTrailingSlashRedirect`. | ZAP 10019 PASS. Open-redirect probes (`//evil.example/`, …) stay on the same site. |
| 9 | Requirement 7 | API error responses, including 404 for unknown `/api/...` paths, had the page CSP or none. | `/api` and `/api/:path*`: `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; sandbox` and `Cache-Control: no-store`, set in `next.config.ts`, so they apply also to errors and unknown paths. nosniff, X-Frame-Options, COOP/COEP/CORP and Referrer-Policy also apply. | Checked on 401 (`/api/v1/state`), 404 (`/api`, `/api/nope`). |

### 17.2 Findings remaining, with justification

CodeQL (security-extended) on `59398e5`, 24 results. None of them is dismissed by me: dismissals are done by the repository owner in the
Security tab, with these reasons.

| Rule | Where | Assessment |
| --- | --- | --- |
| `js/insufficient-password-hash` (8.1) | `src/server/auth.ts:14` | **False positive.** What is hashed is an agent API key: 192 random bits from `randomBytes(24)`, not a password. A slow password hash protects low-entropy secrets against guessing; a 192-bit random value cannot be guessed, so a fast hash such as SHA-256 is sufficient (no salt is needed either: every key is unique). Changing it would invalidate every stored key. |
| `js/file-access-to-http` (6.5) | `examples/hooks/tend-hooks.mjs:173,175` and its copy `public/sdk/tend-hooks.mjs` | **By design.** The adapter reads the agent key from its own config file (owner-only, not a link, checked on the descriptor) and sends it to the TEND address from the same file. That address must now be https (or localhost). This is the adapter's purpose. |
| `js/file-access-to-http` (6.5) | `redteam/live/lib.mjs`, `rbac-matrix.mjs`, `tenant-matrix.mjs`, `scripts/*-e2e.mjs`, `scripts/onboarding-test.mjs` | **Test harnesses.** They read throwaway tokens of a server they started themselves on 127.0.0.1 and call it. Not shipped. |
| `js/http-to-file-access` (6.3) | `scripts/benchmark.mjs`, `scripts/onboarding-test.mjs` | **Test harnesses.** They save the SDK downloaded from the local test server (the thing under test) into a temporary folder, and write benchmark results into `docs/`. Not shipped. |
| `js/file-system-race` (7.7) | `src/server/tester-kit.test.ts:26` | **Test code**: checks a file's mode and then reads it, in a temporary folder the test created. No security effect. |

ZAP baseline (run `44891338821` on `59398e5`): 0 FAIL, 65 PASS, 3 WARN. The three are now listed in `.zap/rules.tsv` as **INFO** (still
printed in every run, not IGNORE):

- **10049 Non-Storable Content** (Informational): pages carry a fresh CSP nonce on each response and API answers depend on who asks, so they
  are not cacheable on purpose.
- **10096 Timestamp Disclosure** (Low): a false positive. The matched number, `1905286922`, is a GitHub comment id in an icon's source URL
  (`issuecomment-1905286922`), found in public static JavaScript.
- **10109 Modern Web Application** (Informational): a hint for crawling, not a weakness.

The ZAP image is now pinned to the digest of that reviewed run.

Other limits that stay:
- `'unsafe-inline'` for `style-src-attr`. Removing it would need every server-rendered `style=""` attribute removed from the UI. The
  remaining risk is CSS-only (no script, no loads); a CSS-injection attack would still need an HTML-injection bug, and the strict script
  policy holds even then.
- The baseline scan is passive and unauthenticated. ZAP's active scan has not been run.
- `scripts/browser-e2e.mjs` (UI flows in WebKit and Chromium) was **not run**: WebKit is not installed here. The security-relevant browser
  tests (two-step sign-in, CSP) ran in Chromium.

### 17.3 Tests on the final code (local, this container)

| Suite | Result |
| --- | --- |
| `npm test` (unit and integration, embedded database) | 629 tests: 584 pass, 0 fail, 45 skipped (40 need PostgreSQL, run below; 5 need macOS `sandbox-exec`) |
| PostgreSQL 16 integration (`postgres`, `postgres-verify`, `rls`) | 40/40 |
| `npm run lint`, `npm run typecheck`, `eslint` on the changed files | clean |
| Agent-escape suite (`redteam/live/run-all.mjs`) | HELD 231, BROKEN/INCONCLUSIVE 0 |
| e2e: authz 26/26, gateway 11/11, connect 8/8, accounts 30/30, open beta 41/41, onboarding 38/38 | all pass |
| Tenant matrix (9,752 requests), RBAC matrix (HELD 36, BROKEN 0), MCP proxy | all HELD |
| Real browser, Chromium: two-step sign-in 9/9, CSP 5/5 (12 pages, 0 violations) | pass |
| Claude Code install flows: hooks 27/27, managed install as root 15/15, coverage 19/19 | pass |
| Hooks adapter unit tests (incl. the new link and key-file tests, each with a negative control against the previous code) | 18/18 |
| `scripts/browser-e2e.mjs` (UI flows, WebKit + Chromium) | **NOT RUN**: WebKit is not installed here |

The server-side suites ran on `5191d5e`. Nothing under `src/`, `next.config.ts` or the package files changed after it (`git diff --stat 5191d5e..ed34a24` is empty for them). Later commits touched only the hooks adapter, local scripts, tests, CI and docs, and those were re-run on the final code.
