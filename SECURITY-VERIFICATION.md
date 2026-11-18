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
3. **Medium:** with no usable `TEND_ADMIN_TOKEN` and `TEND_PUBLIC` unset the instance becomes **publicly readable** (redacted shapes of activity). Confirmed on a production build. Not changed because it could alter a live deployment; set `TEND_PUBLIC=0` explicitly.
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
