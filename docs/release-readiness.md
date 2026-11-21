# Release readiness: controlled-beta MVP (backend freeze `backend-freeze-mvp-1`)

Date: 2026-11-21. Branch `security/verification`. Assessed by an AI assistant from tests it ran and CI it read. **Not an independent
penetration test, not a certification.** Every result below names how it was produced; anything not run is marked **NOT VERIFIED**.

## Verdict: YELLOW

The MVP works end to end and its security tests pass on the final code: the whole user journey with real Claude Code, on PostgreSQL as
production runs it, in a real browser. It is **not GREEN** because of these blockers:
1. no preview has been deployed or verified on Vercel/Neon (this session has no access to the project's environment variables and none to Neon);
2. `main` has no branch protection;
3. the PR's CodeQL check is red until a person reviews the remaining alerts (all assessed below; none is a confirmed vulnerability);
4. production refuses to start after this merge until its database roles are set up (by design, `docs/deployment-checklist.md`).

Backend development **can be frozen** for the design phase: none of the four needs a backend code change, only configuration and review.

## Verified MVP feature set

| Feature | Class | Evidence |
| --- | --- | --- |
| Sign-up, mailed confirmation link, admin approval of beta access, sign-in, sessions, sign out everywhere | real | `e2e:journey` (browser), `e2e:accounts` 30/30 |
| Two-step sign-in (TOTP, recovery codes) | real | `e2e:mfa` 9/9 in Chromium, MFA unit tests |
| Workspace (organization) per account, roles viewer/operator/admin/owner, invitations | real (members: API only, no screen) | RBAC matrix 36 HELD, `rbac.test.ts` |
| Tenant isolation (app checks + PostgreSQL row-level security, restricted login, signed context) | real | tenant matrix 9,752 requests, RLS mutation control, `rls.test.ts` |
| Agent registration, API keys (shown once, hashed, rotate, revoke, optional expiry) | real | `agent-keys.test.ts`, EV-13, journey |
| Policies (allow / ask first / never; most specific rule wins), central policies, simulations | real | `policy` tests, journey (custom policy) |
| **Claude Code: tool calls checked before they run** (PreToolUse hook, fails closed) | **real enforcement** | `e2e:journey` 21/21, `e2e:claude-hooks` 27/27, coverage 19/19, managed install (as root) 15/15, `hook-failclosed` 11 HELD |
| Approvals: request waits, person approves or rejects on the dashboard, spent exactly once, expires | real | journey (clicks "Allow once"), `authz.test.ts`, EV-1/EV-7 |
| TEND gateway (TEND holds the credential and executes) | real enforcement | `e2e:gateway` 11/11 |
| MCP proxy in front of an MCP server | real enforcement | `mcp-proxy` HELD (deny, approval, replay, fail-closed) |
| SDK wrappers in the agent's process (`connectTend`/`guardTool`, Python `Gate`) | **cooperative only**: not a boundary against an agent that skips them (`docs/enforcement.md`) | unit tests |
| Activity: PostToolUse outcomes, session start/stop, agent reports | **monitoring** (reported by the agent) | journey, hooks suite |
| Audit log (hash chain, append-only for the app, checkpoints) | real | journey (chain verifies), backup/restore drill |
| Alerts (webhook) | real, per instance | `alerts-e2e` |
| Demo workspace, sample agent, Lindenhof example agent, notes demo | **simulated** (synthetic data and tools) | — |
| Cursor hooks | **NOT VERIFIED** (built from Cursor's docs; `cursor-agent` not signed in) | — |
| Claude Code `--bare`, per-project hooks with `disableAllHooks`, any agent that does not call TEND, local administrators | **unsupported / bypass** | `docs/assistant-integrations.md` |
| SSO, several organizations per account, renaming a workspace, member-management screen | **not implemented** | — |

## Tests executed (this session, final server code; CI on `7009aee`)

Locally:
- `npm test`: 584 pass, 0 fail, 45 skipped. 40 of the skips are PostgreSQL tests, run separately (40/40); 5 are macOS-only.
- **`npm run e2e:journey`** on PostgreSQL (restricted login, RLS): 21/21. Negative control with the deny rules removed: the 4 enforcement checks fail as they must.
- Security suites:
  - agent escape: 231 HELD;
  - module attacks: 29 HELD;
  - production configuration: 9 HELD;
  - dynamic scan: 6 HELD;
  - hooks fail-closed: 11 HELD;
  - tenant matrix, RBAC matrix, MCP proxy: all HELD;
  - browser: CSP (12 pages, 0 violations) and MFA.
- `npm audit`: production dependencies 0 vulnerabilities; all dependencies 12 moderate (dev-only), 0 critical.

On GitHub Actions: `security` (4 jobs), `codeql`, `secret-history` (gitleaks over the whole history), `zap-baseline` and the new `zap-active`
(§ below). Run ids are in `SECURITY-VERIFICATION.md` §17–18.

## Security checklist

| Area | Status | Evidence |
| --- | --- | --- |
| Authentication, sessions | pass | accounts e2e, session tests, `__Host-` cookies, HSTS in production |
| Authorization (roles) | pass | `routes.test.ts` (every route classified), RBAC matrix, mutations M-19/M-20 |
| Tenant isolation | pass (local PostgreSQL); **NOT VERIFIED on Neon** | tenant matrix, RLS defence-in-depth mutation |
| API key handling | pass | SHA-256 of 192-bit random keys, shown once; refused over plain http to remote hosts by every client |
| Secret management | pass in code; hosting **NOT VERIFIED** | gitleaks history, secretlint, the code reads no `NEXT_PUBLIC_` variables, and a grep of the built browser bundles finds no key, token or database URL (only the variable *name* `TEND_ADMIN_TOKEN` in a help sentence); preflight script |
| Policy enforcement | pass | journey, hooks suites, gateway, MCP proxy |
| Replay protection | pass | spent token fails and alerts; approval spent once (EV-7, `authz.test.ts`) |
| Token / approval / key expiry | pass | `authz.test.ts` expiry tests, EV-1, EV-13 |
| Fail-closed | pass | hooks fail-closed 11 HELD, MCP-7, prod start-up refuses unsafe DB config |
| Rate limiting | pass, **per instance** | 429 budgets tests; put Vercel firewall limits in front for volumetric abuse |
| Audit log integrity | pass | hash chain verify, checkpoint drill |
| Secure headers | pass | ZAP baseline 0 WARN, CSP browser test, prod-config |
| Dependency vulnerabilities | pass | `npm audit` |
| Database access controls | pass (local PostgreSQL 16) | restricted login, `REVOKE TEMPORARY`, owner-only key table, negative controls |
| Authenticated active scan | see `SECURITY-VERIFICATION.md` §18 | `zap-active` workflow, against a throwaway local build (not a preview) |

## Remaining risks (accepted for a controlled beta, documented)

- Enforcement covers only agents that go through TEND: Claude Code with hooks, the gateway, the MCP proxy. SDK wrappers are cooperative.
- Per-project Claude Code hooks can be turned off by the user (`disableAllHooks`). The managed install cannot, except by a local administrator.
- The platform admin is one shared token, with no second factor; there is no SSO.
- Alerts and rate limits are per serverless instance.
- `style-src-attr 'unsafe-inline'` (style attributes only; scripts are strict).
- No independent penetration test.

## Exact manual actions (yours)

1. **Branch protection on `main`** (GitHub → repository → Settings → Branches → Add branch ruleset, or "Add classic protection rule"):
   - target `main`; require a pull request before merging, with 1 approval;
   - require status checks to pass, branch up to date. Add these checks:
     - "Types, lint, static analysis, dependencies, secrets"
     - "Unit and integration tests"
     - "Concurrency guarantees on real PostgreSQL"
     - "Production build and isolated enforcement tests"
     - "analyze" (CodeQL)
     - "gitleaks"
   - block force pushes and deletions; include administrators.
2. **Review the CodeQL alerts** (Security → Code scanning, filter `pr:1`). Dismiss each one only after reading the reason in
   `SECURITY-VERIFICATION.md` §17.2, or ask for a change.
3. **Isolated preview on Neon + Vercel**: follow `docs/deployment-checklist.md` exactly. In short:
   1. Create the branch: Neon console → project → Branches → New branch `preview-mvp` from `main`, **with no production data**. If the
      production branch holds real customer data, create it from an empty schema instead (option "Schema only"), or start a fresh branch.
   2. Run the checklist's SQL for `tend_app` on that branch.
   3. In Vercel → tend-beta → Settings → Environment Variables, add the checklist's variables with scope **Preview** only, limited to the
      Git branch `security/verification`. Use the preview branch's connection strings. Do not edit Production values.
   4. Run the preflight: `vercel env pull --environment=preview --git-branch=security/verification .env.preflight`, then
      `node scripts/check-production-config.mjs .env.preflight`, then delete the file. It must print "No blocking problems".
   5. Deploy (Git deployments are off in `vercel.json`): `vercel deploy` from a checkout of `security/verification` (a preview, not `--prod`).
   6. Give me the preview URL and a Deployment Protection bypass token (Vercel → Settings → Deployment Protection → Protection Bypass for
      Automation). With those I can run `scripts/hosted-check.mjs` and the checklist's §4 checks against the preview.
4. **Before the next production deploy** (after merging): the same database roles and variables for **Production**, or production will
   refuse to start. That refusal is the intended fail-closed behaviour.
