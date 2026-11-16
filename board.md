# Hive board

_Shared plans live here. The god agent is the scribe._

## Mission: Break TEND before users do (QA team)

**Goal:** A team that tests TEND end-to-end, attacks it, and reports exactly what's broken in `qa/REPORT.md`. Security product — must fail closed.

**Test target:** repo `~/Documents/tend-beta`, branch `site`, local only (PGlite + `npm run dev`). NEVER touch tendhq.dev / prod DB / prod env. No push/merge/deploy. Agents write tests+reports only, never app code.

**Scope note (open):** Brief's approval-notification features (`src/server/approvals.ts`, `/api/v1/approvals`, `/api/telegram/webhook`, `/approvals/[id]`, Web Push beyond sw.js) are ABSENT on `site`. Branch `feat/approval-notifications` not found locally/origin. Asked human for the branch/preview. Until answered, team tests core TEND (gateway, auth/`requireOperator`, approvals via `decide()`, expiry, audit hash-chain).

### Team (5 agents, sequenced)
1. **Mapper** — `qa/TEST_MAP.md`: features, routes, data flows, trust boundaries, existing vs missing tests. RUNS FIRST; others wait on it.
2. **Red Team** — `qa/attacks/` automated attack suite (gateway bypass, approve-without-permission, double-decide, expiry, fail-closed, audit tamper, input abuse, prompt injection).
3. **E2E Tester** — `qa/e2e/` Playwright: signup→connect→rule→block→approve/deny→audit; Settings/Notifications; EN+DE.
4. **Agent Integrator** — demo agent using TEND as documented; setup time (<5min goal), added latency, doc gaps.
5. **Reviewer** — dedupes, re-runs every repro, writes `qa/REPORT.md` sorted by severity + top-5 fixes.

**Run command:** all new tests under one command (`npm run test:qa` or similar).

### Process
- Mapper alone first → status to human. Then start 2–5.
- Escalate any CRITICAL to human immediately.
- Final: status to human when `qa/REPORT.md` done.
