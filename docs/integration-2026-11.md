# Integration of the two November 2026 security lines

Branch `integration/security-reconcile`, created from `origin/security/verification` (aa53c04, "Backend freeze point for the controlled-beta
MVP"), with the unique work of `origin/claude/blissful-euler-7j8rdz` ported on top, one reviewed commit at a time. Both original branches are
unchanged. Nothing was merged into `main`, pushed or deployed.

## Why this base

Both branches start at `main` (c6c3c5f). `security/verification` (73 commits) is the deeper security line: row-level tenant isolation in
PostgreSQL with a signed, transaction-bound tenant context; least-privilege database roles; workspace roles and invitations; two-step sign-in
for accounts; CodeQL, Semgrep, eslint-plugin-security, secretlint, OWASP ZAP (baseline and authenticated active); a red-team suite, a tenant
matrix, mutation controls; operations runbooks and drills. `claude/blissful-euler-7j8rdz` (17 commits) added the design system, a set of
hardening fixes, versioned presets and CI gates. Rebasing the deeper line onto the smaller one would have meant re-resolving 73 commits of
security-critical database work; porting 17 onto the deeper line keeps that work exactly as reviewed.

## What came from where

| From `blissful-euler` | Integrated as | Notes |
|---|---|---|
| Design system 2.0 and `/design-system` (21ad886, 8390315) | as is | New files; additive token block in `globals.css`; the route is on the public-site list (no polling) |
| `tendHttp` timer that keeps the process alive (d07555b) | merged into this branch's version | Keeps this branch's https-only guard for agent keys |
| Theme cookie and accessibility fixes for `/design-system` (d07555b) | as is | |
| Next 16.4.6 (d07555b) | already here | |
| Isolated-server listener via `/proc` (a6a3ccb) | this branch's implementation kept; the fail-closed check and the regression test added | Both branches had found the same lsof bug |
| Database TLS: pin `verify-full` when a remote URL has no `sslmode` (069ca11) | as is | Not covered here before |
| Preset wording, versioned presets (Balanced v2, Strict v2) (c52dace, 8299e26) | as is | Not covered here before |
| Enforcement demo with a side-effect ledger (bbb748e) | adapted | Now lets `startIsolatedServer` set PostgreSQL up as production runs it, so its cross-tenant checks also run there |
| Test gate and audit gate (f53bda1) | wired into this branch's workflow | That branch's own workflow file not taken |
| Dependency fixes: minimatch override; hono, @hono/node-server, typescript-eslint in range | redone on this lockfile | 12 moderate advisories here before |
| Two tenants on real PostgreSQL (18f4503) | as is | Application-layer checks; this branch's RLS tests cover the database layer |
| Admin second factor (61c721c) | re-implemented on otplib | Fills "Not covered: two-step for the platform admin token" |
| Backup drill (752ac8a) | its three extra checks added to this branch's drill | One drill, not two |
| Runbooks for rotation and backups (752ac8a) | not taken | `docs/operations.md` covers both; the admin second factor's secret was added there |
| Its workflow and gitleaks tuning (f53bda1, 39f2c74, f966bff, 11b6f67) | not taken | This branch's workflows are the base; see CI below |
| Security review documents (a40bf83, 840ce56) | as is | `SECURITY-VERIFICATION.md` stays the main record |

## Conflicts and how they were resolved

- `package.json`, `package-lock.json`: this branch's versions kept, the dependency fixes redone with npm and checked (`npm audit`: 0).
- `examples/claude-agent/agent.mjs`: both changes kept (https-only guard, cleared timer).
- `scripts/isolated-server.mjs`: this branch's `/proc` reader kept; the fail-closed check added.
- `.github/workflows/security.yml`: this branch's file kept and extended (below); the other branch's file dropped.
- `.gitleaksignore`: this branch's file kept. The admin second factor's tests build their secrets from bytes, so no new entry was needed.
- Semantic: two TOTP implementations. The hand-written one was dropped; the admin factor uses otplib like accounts do.
- Semantic: two backup drills. One drill, with the union of their checks.
- Semantic: the enforcement demo bypassed this branch's PostgreSQL provisioning (it set its own `DATABASE_URL`) and could not start under the
  production setup; it now uses the provisioning.

## Found while verifying, fixed here

- **Scroll lock blocked by the style policy** (from this branch's CSP, not from the port). With a dialog, the mobile menu or a select open,
  react-remove-scroll adds a `<style>` without a nonce; the browser blocked it and the page kept scrolling behind the open menu (on `main`,
  which has no style policy, it is locked). It now gets the request's nonce (`src/lib/style-nonce.ts`, read from Next's nonced scripts and
  handed to `get-nonce`). The select menu's one fixed rule is allowed by its exact hash, checked against `node_modules` like the toast
  library's. The policy is unchanged (still no `'unsafe-inline'` for style elements). `redteam/live/csp-browser.mjs` now opens the mobile
  menu and a select; without the fix it fails on both.

## Homepage, dashboard and product pages

Production builds of `main` and of this branch, 17 routes, desktop and phone, reduced motion: pixel-identical except `/security` (the text
change below) and one region of `/product/approvals` that differs between runs of the same build (a lazily rendered phone mockup; with a
longer wait both are identical). `src/components/marketing` and `src/app/page.tsx` are byte-identical to `main`.

The scroll-driven 3D homepage passage (2b45a3e, 9844d63) is on neither branch nor on `main`: it is only on `claude/elegant-bohr-y0s75q` and
`claude/hopeful-pasteur-ip5l7l`. It is not part of this integration.

## Website claims

`/security` listed "No roles or two-factor sign-in" as a limitation; this branch has workspace roles and per-person two-step sign-in, and
now an optional second factor for the admin token. The item now reads "No single sign-on yet" and says what exists and what does not
(no workspace-wide two-step requirement; the admin token is one shared credential). No claim found that goes beyond what is tested.

## CI after integration

All five workflows of this branch, with these changes:

- Every action pinned to the commit of its latest release in the major version already used (was `@v4`, `@v3`, `@v5`).
- `secret-history`: the same gitleaks 8.18.4, as its release binary checked against the published SHA-256 (was a container referenced by
  tag), over the history of the commit being checked (`--log-opts=HEAD`).
- `security` / static: adds the dependency gate (any advisory, any dependency, reviewed allow-list with expiry).
- `security` / test: `npm test` through the test gate (`--allow-db-skip` only here).
- `security` / postgres: every test file that needs the database, found by `grep`, through the gate with no skip allowance and a floor of 44
  tests; `postgres-tenancy.test.ts` had been run by no job. The backup drill now fails in CI when its database URL is missing.
- `security` / postgres and enforcement: `e2e:enforcement` added to the end-to-end suites.
- `security-gate`: one check that passes only if the four jobs passed. Require it, `gitleaks` (secret-history) and `Analyze` (CodeQL) on `main`.

## Results (local, 2026-11-22, at the commit that adds this file)

PostgreSQL 16 on this machine; Chromium for the browser checks. Every command is the one the workflows run.

| Check | Result |
|---|---|
| typecheck, lint, production build | pass (lint: 0 errors, 1 warning that predates this work) |
| eslint security config, secretlint over every tracked file | pass |
| audit gate, `npm audit --omit=dev --audit-level=low`, lockfile integrity | 0 advisories across 853 dependencies; every package hashed, one registry |
| unit tests through the gate, no database | 660 tests: 611 pass, 0 fail, 49 allowed skips (44 need PostgreSQL, 5 need macOS) |
| `npm test` with PostgreSQL | 660 tests: 655 pass, 0 fail, 5 skip (macOS sandbox) |
| PostgreSQL files through the gate (floor 44) | 44/44, no skip |
| e2e: authz, gateway, connect, accounts, open-beta, onboarding, enforcement | all pass: embedded database; PostgreSQL production setup; PostgreSQL single-owner setup (26, 11, 8, 30, 41, 38, 30 checks each time) |
| tenant matrix, MCP proxy, role matrix, alerts, hook fail-closed (PostgreSQL) | all hold (tenant matrix: 9,752 cross-tenant requests, nothing of A returned or changed, no 5xx) |
| two-step sign-in in a browser (`mfa-e2e`) | 9/9 |
| CSP in a browser, with a menu and a select opened | 7/7 (fails without this branch's fix) |
| `redteam/attacks.ts` | 29 held, 0 broken; the 2 documented audit gaps (D7a, D8a) confirmed |
| `redteam/live/run-all.mjs`, prod-config, dynamic scan, tenant matrix, MCP proxy, hook fail-closed (embedded) | all hold (run-all: 231 held, 0 broken) |
| backup and restore drill | 11/11 |
| context-key rotation drill | 6/6 |
| mutation controls M-16 to M-23, route mutations | every mutation detected; with a route check removed, row-level security still held |
| admin second factor, mutated by hand (replay guard removed; code not required) | both detected by `admin-mfa.test.ts` |

Not run here: gitleaks over the history (the sandbox refused to run the downloaded binary; CI runs it), CodeQL and OWASP ZAP (CI only),
the macOS sandbox tests.
