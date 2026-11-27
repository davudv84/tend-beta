# CI and merge protection

**Status: none of these workflows has run on GitHub yet.** They were written and their steps run locally where possible (below). Treat them as
IMPLEMENTED BUT UNVERIFIED until the first green run on GitHub.

| Workflow | Runs | Locally verified |
| --- | --- | --- |
| `security.yml` › static | types, lint, eslint-plugin-security, Semgrep (pinned rules), `npm audit` (prod any severity, all critical), secretlint | types, lint, `npm audit --omit=dev` (0) |
| `security.yml` › test | build, `npm test`, mutations M-19…M-22 | yes |
| `security.yml` › postgres | PostgreSQL tests (RLS-1…12), DB mutations M-16…M-18, backup and key-rotation drills, all e2e suites in the production default and the legacy owner-login mode, tenant matrix, MCP proxy, role matrix, alert delivery, two-step sign-in in Chromium, route mutations | each step, on a local PostgreSQL 16 (not as one job) |
| `security.yml` › enforcement | build, module attacks, run-all, production configuration checks | yes |
| `codeql.yml` | CodeQL `security-extended`, weekly and on every PR | **no** (needs GitHub) |
| `secret-history.yml` | gitleaks v8.18.4 over the full history | **no** (no Docker here) |
| `zap.yml` | OWASP ZAP baseline against a build started inside the job, by hand only | **no** (no Docker here) |

Supply chain: workflow-level `permissions: contents: read`; CodeQL alone gets `security-events: write`; every checkout sets
`persist-credentials: false`; triggers are `pull_request` (no secrets reach forks' code) and `push` to `main`, never `pull_request_target`;
Semgrep, gitleaks, Playwright and the drills use pinned versions. GitHub's own actions are referenced by major tag (`@v4`, `@v3`); pinning
them to commit SHAs needs the SHAs looked up on GitHub (not done here), after which Dependabot (`.github/dependabot.yml`) keeps them current.

## Make failures block merging (repository settings, by an admin)

Settings → Branches → add a rule (or ruleset) for `main`:

1. Require a pull request before merging, with 1 approval; dismiss stale approvals; require review from code owners if a `CODEOWNERS` file is
   added for `src/server/` and `.github/`.
2. Require status checks to pass, and require branches to be up to date. Required checks: `Types, lint, static analysis, dependencies, secrets`,
   `Unit and integration tests`, `Concurrency guarantees on real PostgreSQL`, `Production build and isolated enforcement tests`, `analyze`
   (CodeQL), `gitleaks`.
3. Block force pushes and deletions; include administrators.
4. Settings → Actions → General: "Read repository contents" as the default workflow permission; do not allow Actions to approve pull requests.
5. Settings → Code security: enable secret scanning and push protection, Dependabot alerts.

None of this is configured from here: it changes the repository's settings and needs an admin's approval.
