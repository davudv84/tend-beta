# Marketing site integrated onto the security-verified branch

Branch `integration/marketing-site`, from `integration/security-reconcile` (be3ec51, all five security workflows green). The four commits of
`claude/hopeful-pasteur-ip5l7l` on top of `main` were cherry-picked in order: the gateway backdrop, the scroll-driven 3D passage as the hero, the
four-stage 3D story of real screens, and "Start in three steps". The 3D is CSS 3D and Motion; there is no canvas, WebGL or external asset.
Both original branches are unchanged. Nothing was merged into `main` or deployed.

## Conflicts and fixes
- `src/app/globals.css`: both branches appended a block at the end. Git matched the design system's closing brace to the marketing block's last
  one, leaving `@theme` unclosed (the production build failed, "Missing closing } at @theme"). Fixed: the merged file adds exactly the 150 lines
  the marketing branch added, nothing else. Commits 695ffe0 to 442bb47 do not build on their own; the fix commit makes the branch build.
- `src/i18n/en.ts`, `de.ts`: merged without conflict.

## Claims
- "Every action they ask for is checked against your rules" now reads "Every action an agent sends through TEND is checked ..." (EN, DE): TEND
  only checks what goes through it (`docs/security-limitations.md`).
- "Everything starts blocked" (on `main` already, and repeated by the new copy) is true for requests sent to TEND: a new agent with no rules is
  denied everything (its enforcement mode is `monitor`, which only governs how executions reported without an authorization are flagged).
  `src/server/default-blocked.test.ts` pins it.
- "All seven test scenarios" matches `docs/verification-report.md`.

## Verification (local)
Typecheck, lint, build; `npm test` through the gate with PostgreSQL (661 tests, 656 pass, 5 allowed macOS skips); PostgreSQL gate 44/44; the seven
end-to-end suites on PostgreSQL; tenant matrix, role matrix, MCP proxy, hook fail-closed, two-step sign-in in a browser; `attacks.ts` (29 held),
`run-all` (231 held), production config, dynamic scan; audit gate; security lint. `redteam/live/csp-browser.mjs` now also scrolls the whole home
page under the policy and asserts the 3D passage moves (no violations).
