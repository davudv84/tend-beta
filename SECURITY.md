# Security policy

## Reporting a vulnerability

Report suspected vulnerabilities privately, not in a public issue:

- **GitHub private vulnerability reporting** on this repository (Security tab, "Report a vulnerability"), or
- the security contact address published on the TEND website. **Before launch, the maintainers must set one and add it here**; until then use
  GitHub's private reporting.

Please include what you did, what you expected, what happened, and the version or commit. Use only your own accounts and synthetic data. Do not
access other people's data, run denial-of-service tests, or test the hosted service beyond your own workspace.

What to expect (targets, not contractual):

| Step | Target |
| --- | --- |
| Acknowledgement | 3 working days |
| First assessment (severity, whether it reproduces) | 10 working days |
| Fix or mitigation for critical / high findings | 30 days |
| Fix for medium / low | next planned release |
| Public advisory | after a fix is available, coordinated with the reporter |

We do not take legal action against good-faith research that follows this policy.

## Supported versions

TEND is in beta. Only the latest commit on the default branch and the current hosted deployment receive fixes.

## How vulnerabilities are handled internally

See `docs/incident-response.md` (triage, severity, containment, communication) and `docs/operations.md` (secret rotation, backups,
monitoring). Dependency and code scanning run in `.github/workflows/security.yml` (npm audit, Semgrep, eslint-plugin-security, secretlint and
the security test suites). That workflow has not yet run on GitHub.

## What is and is not protected

`docs/security-limitations.md` states what TEND enforces and what it does not. `SECURITY-VERIFICATION.md` lists every test behind those
statements and what was **not** verified. These are internal and AI-assisted reviews, not an independent penetration test.
