# TEND private beta: QA report (2026-10-30)

Scope: the tend-beta code at commit 3f8cf61 plus the fixes below, tested locally (isolated production builds, `TEND_ADMIN=0`), with real
Claude models, and against the live beta at https://tend-beta-mauve.vercel.app where that was safe (unauthenticated and read-only checks, and
one sign-up to Resend's test recipient). Every number here comes from a run in this session.

Kinds of evidence, kept apart throughout:
- **Simulated**: scripted stand-ins or fake models, no provider involved.
- **Local**: real HTTP against an isolated production build on 127.0.0.1, real browser, local mail outbox.
- **Real model**: a real Claude model chooses its tool calls; TEND decides.
- **Production**: requests to the live beta.

## 1. Features discovered

`npm run qa:inventory` reads them from the code: **107** in total.

| Kind | Count |
|---|---|
| Pages | 27 |
| API handlers | 49, in 40 routes |
| Integrations in the catalog | 18 |
| Security mechanisms | 13 |

All 13 security mechanisms the inventory looks for were found in the code. Every API route except `/api/health` calls an
authentication guard.

## 2. Tested and untested

| Area | Tested | How | Not tested |
|---|---|---|---|
| API routes | 40/40 called over HTTP by at least one test | local | none |
| Pages | 15 rendered and used in a real browser (Chromium); all 27 return the expected status | local; 9 also production (signed out) | Interactive use of the forgot/reset forms (the API is tested), the check-ins, labs, research, reflections, sanctuary, developers and prototype pages, and an agent's own page with real data |
| Authentication (sign-up, verification, sign-in, sign-out, reset, sessions, `TEND_ADMIN=0`) | all | local, browser; production for the signed-out surface | A real inbox on production |
| Workspace isolation | agents, policies, approvals, events, keys, central policies, simulations, integration status | local | none |
| Enforcement (allow, deny, approve, reject, revoke, replay, expiry, outage, concurrency) | all | local, real model | none |
| Integrations | 13 verified with claude-haiku-4-5 | real model | 8 blocked: Gemini, Mistral, Groq, Ollama, Cursor, Cline, Hermes, OpenClaw (no key or tool here) |
| OpenAI | OpenAI Agents SDK, driving Claude through Anthropic's OpenAI-compatible endpoint | real model (Claude) | A real OpenAI model (no OpenAI key available) |
| Email | registration, verification, reset, expired and invalid links, delivery failure | local; production delivery accepted by Resend | Arrival in a real inbox |
| Mobile | layout (no horizontal scroll at 375 px), menu, sign-out | local | Tablet sizes, Safari/WebKit |

## 3. Results

| Suite | Result | Kind |
|---|---|---|
| lint, typecheck, build | clean | |
| unit tests | 477 tests: 458 pass, 0 fail, 19 skipped. The first run had 1 failure, finding 3 below | simulated/local |
| PostgreSQL | 19/19 | local |
| e2e: accounts | 30/30 | local |
| e2e: open-beta | 41/41 (11 checks added today) | local |
| e2e: authz | 26/26 | local |
| e2e: gateway | 11/11 | local |
| e2e: connect | 8/8 | local |
| onboarding | 10/10 | local |
| reliability | 10/10 cases fail closed (47 subtests: database down, TEND down, replay, double execution, cross-tenant, …) | local |
| beta rehearsal | 46/46 | local |
| real agents, offline probes | 13/13 | local |
| QA agent (claude-opus-4-8): 40 turns, 67 requests | 0 findings, $0.83 | real model, local |
| e2e: real Claude | 5/5 scenarios (allow, deny, approve, reject, revoke) | real model |
| e2e: real agents (Anthropic) | 16/16 | real model |
| verify:integrations | 13 verified, 8 blocked, 0 failed | real model |
| hosted check | 31/31 | production |
| browser walk-through | 2 bugs found (1 and 2 below) | local + production |

Model spend: about **$1.07** of the $2 cap. That is $0.87 for the QA agent including its smoke run, $0.15 for integrations, $0.01 for
real Claude, and an estimated $0.03 for real agents (that suite does not print its cost).

## 4. Critical security vulnerabilities

**None found.** The QA agent, the reliability suite and the isolation checks also found nothing high. This is not proof that none exist:
there was no independent review.

## 5. Functional bugs

1. **High, beta blocker, live.** With `TEND_ADMIN=0`, the front page's only "Sign in" button links to `/operator`, which returns 404, so a
   tester who opens the beta's address cannot find sign-in.
   Reproduce:
   ```
   curl -s https://tend-beta-mauve.vercel.app/ | grep -o 'href="/operator"'     # prints the link
   curl -s -o /dev/null -w '%{http_code}' https://tend-beta-mauve.vercel.app/operator   # 404
   ```
   **Fixed locally:** `src/app/page.tsx` and the preferences link in `src/ui/shell.tsx` go to `/account/sign-in` when accounts are on.
   Regression check: e2e:open-beta "the front page's Sign in goes to the account sign-in". Not deployed.
2. **Medium.** After a successful test run, the Connect wizard says "The action did not complete — already_consumed" if the agent sends
   its spent token again. The action did run; the refused replay is recorded as a second gateway event, and the screen showed the newest.
   Reproduce: run the wizard's script, approve, then POST the same token to `/api/v1/gateway/execute` again. The second call returns
   409 and the page flips to failed.
   **Fixed:** `src/lib/onboarding.ts` takes the success when there is one. The new assertion in `src/lib/onboarding.test.ts` fails without
   the fix and passes with it.
3. **Low, test tooling.** The export scanner's home-path pattern was case-insensitive and flagged `/api/admin/users/u_x` in a test, which
   failed `npm test`.
   **Fixed:** `scripts/tester-export.mjs` matches `/Users/<name>` case-sensitively. Real home paths are still caught.

## 6. UX problems (not fixed)

- `/operator` with the admin off: the 404 page's title still reads "Operator sign-in · Tend".
- Mobile agent list: "Not connected right now · last heard 3m ago" is cut to "Not connecte…".
- An agent shows "Disconnected" about two minutes after its last call. This is by design, but a tester who just finished the
  wizard may read it as a failure.

## 7. Fixes implemented

- Bugs 1–3 above.
- New tests:
  - `src/server/email.test.ts`: a refused or unreachable mail service never breaks sign-up, keeps sending the rest, and logs no link or
    address.
  - 11 more checks in `scripts/open-beta-e2e.mjs`, covering the six routes that had no HTTP test (resend, check-ins, integrations
    status, policy simulations, sample agent, demo check-ins) and the front page link.
- New tools:
  - `npm run qa:inventory`: the inventory from the code.
  - `npm run qa:agent`: the exploratory Claude QA agent, with a hard dollar cap and a disposable server.

## 8. Remaining limitations

- No real OpenAI model was tested (no OpenAI key).
- Signed-in flows were not run on production, because they need a real mailbox. They were tested locally on the same build.
- Browser testing was interactive in Chromium, not a repeatable Playwright suite (not installed). WebKit/Safari was not tested.
- No load test beyond the concurrency cases (double execution, concurrent executions).
- The QA agent ran out of budget before writing its own summary. Its coverage was read from its request log.
- With the admin off, an account cannot be disabled from the app. Re-enable the admin, or set `disabled_at` in the database.
- The production log carries the pg SSL-mode warning. Use `sslmode=verify-full` in `DATABASE_URL`.

## 9. Readiness

**8/10 once bugs 1 and 2 are deployed** (6/10 as deployed now).

- Enforcement, isolation, authentication and fail-closed behaviour pass every local, real-model and production check that ran.
- What holds it back: the live front page is broken until the fix ships, there is no real-OpenAI test, there was no signed-in test on
  production, and there was no independent security review.

## 10. Recommendation

**GO for three beta testers, after deploying the two fixes.** Until then, send testers the direct link
`https://tend-beta-mauve.vercel.app/account/sign-up` rather than the front page.
