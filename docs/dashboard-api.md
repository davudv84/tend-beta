# Dashboard and website: what the frontend may use (backend freeze contract)

Frozen at the commit "Backend freeze point for the controlled-beta MVP" on `security/verification` (see `docs/release-readiness.md`). The design phase changes how things look and move, not what the server
does or accepts. Anything that needs a backend change goes through a separate, reviewed security change.

## Use these, not raw `fetch`

| Module | What it is |
| --- | --- |
| `src/lib/store.ts` | The client store every screen uses: state, polling, and every action (`registerAgent`, `rotateKey`, `decide`, policy saves, …). It handles the session, same-site requests, the "only report done when the server confirmed" rule, and errors. |
| `src/lib/types.ts` | `Agent`, `Authorization`, `Viewer`, `Provider`, … |
| `src/lib/projection.ts` | `Projection`: what `GET /api/v1/state` returns as `projection` (`agents`, `authorizations`, `taskEvents`, `checkIns`, `log`, `tasks`, `requests`, `asks`) and how events update it. |
| `src/i18n/en.ts`, `src/i18n/de.ts` | Every visible string. Change wording here. |

## Routes the dashboard calls

Auth: **session** = the signed-in browser cookie (`__Host-tend_operator` in production, `tend_operator` on plain-http localhost; same-site only); **agent** = an agent's API key (never from a
browser); **admin** = the platform admin's session. The minimum workspace role is enforced on the server (`src/server/rbac.ts`); the UI only
hides what a role cannot do. `src/server/routes.test.ts` fails the build if a route's guard changes.

| Route | Auth | Minimum role | Used for |
| --- | --- | --- | --- |
| `GET /api/operator/session` | none or session | — | who is signed in (`viewer`), instance mode |
| `DELETE /api/operator/session` | session | — | sign out |
| `GET`/`DELETE /api/operator/sessions` | session | viewer (own) | list sessions, sign out everywhere |
| `POST /api/account/register`, `verify`, `resend`, `sign-in`, `forgot`, `reset`, `invitation` | none (same-site) | — | account pages |
| `GET`/`POST /api/account/mfa` | session | viewer (own) | two-step sign-in setup |
| `GET /api/v1/state` | session | viewer | the whole dashboard (`projection`, `viewer`) |
| `GET /api/v1/events?since=<seq>` | session | viewer | incremental updates and the activity log |
| `POST /api/v1/agents` | session | admin | register an agent; the response carries `apiKey` **once** |
| `POST`/`DELETE /api/v1/agents/:id/keys` | session | admin | rotate / revoke a key |
| `GET`/`POST /api/v1/agents/:id/policy` | session | viewer / admin | read / save rules (`expectedVersion` required on save) |
| `POST /api/v1/agents/:id/control` | session | operator | pause / resume |
| `GET`/`POST /api/v1/agents/:id/verification` | session | operator | "Test my protection" |
| `POST /api/v1/agents/:id/check-in-requests` | session | operator | ask an agent to check in |
| `POST /api/v1/reviews/:id` | session | operator | approve / reject a request (`{ status: "approved" \| "rejected", note? }`) |
| `POST /api/v1/policy-simulations` | session | viewer | "what would this policy do" |
| `GET`/`POST /api/v1/central-policies`, `…/:id`, `…/:id/assignments` | session | viewer / admin | workspace-wide policies |
| `GET /api/v1/integrations/status` | session | viewer | connection status |
| `GET`/`POST /api/v1/onboarding`, `POST /api/v1/sample-agent` | session | viewer / admin | first-run steps, sample agent |
| `GET /api/v1/notifications`, `POST …/read`, `GET`/`POST …/preferences`, `POST`/`DELETE …/subscriptions`, `POST …/test` | session | viewer / operator | notifications |
| `GET`/`POST /api/v1/members`, `PATCH`/`DELETE /api/v1/members/:id` | session | viewer / admin | members and invitations |
| `GET /api/admin/users`, `POST /api/admin/users/:id`, `GET /api/admin/audit` | admin | platform admin | beta access approvals, audit-chain check |
| `GET /api/health` | none | — | status |

Agent-side routes (`/api/v1/authorize`, `/api/v1/authorizations/**`, `/api/v1/gateway/**`, `/api/v1/agent/inbox`, `POST /api/v1/events`,
`POST /api/v1/check-ins`) are for agents and SDKs only. A browser must never call them or hold an agent key.

Errors are always JSON `{ error: "<code>", message: "<human text>" }` with the HTTP status. Show `message`; branch on `error`.

## Rules the design must stay inside (enforced by the server, tested)

- **Content-Security-Policy** (`src/lib/csp.ts`, tested in `csp.test.ts` and in a real browser by `redteam/live/csp-browser.mjs`):
  - scripts only from this site (Next's own, nonce plus `'strict-dynamic'`): no CDN scripts, no inline `<script>`, no `onclick=""` attributes;
  - `<style>` elements and stylesheets only from this site or with the request's nonce: no runtime CSS-in-JS that injects `<style>` (the
    toast library's CSS is allowed by its exact hash; **upgrading `sonner` needs the hash updated**, which the test says);
  - `style=""` attributes are allowed (React inline styles, Motion/Framer-style animations that set `style` work);
  - images: `'self' data: blob:`; fonts: `'self' data:`. **no font or image CDNs**: `next/font/google` and `next/font/local` are fine (Next serves
    the files from this site, as `src/app/layout.tsx` does today); a `<link>` to fonts.googleapis.com is blocked. Put images in `public/`;
  - `connect-src 'self'`: the browser talks only to TEND itself (no third-party analytics beacons);
  - no framing of TEND (`frame-ancestors 'none'`).
- **Cross-origin isolation** (COEP `require-corp`, CORP `same-origin`): every image, font, video and script must come from TEND itself.
  A cross-origin embed (YouTube, a remote Lottie file, an external SVG) is blocked. Bundle it or self-host it.
- Run `node --no-warnings redteam/live/csp-browser.mjs` (needs `npm run build` and Playwright) after design changes: it fails on any CSP
  violation or blocked load on the main pages.

## Frozen (do not change during the design phase without a security review)

`src/server/**`, `src/app/api/**`, `src/proxy.ts`, `src/lib/csp.ts`, the `headers()` block of `next.config.ts`, `src/lib/store.ts` request
handling, `examples/hooks/**`, `examples/claude-quickstart/tend-client.mjs`, `examples/python/**`, `public/sdk/**` (generated), the
database migrations, `.github/workflows/**`, `.zap/rules.tsv`.

## Free to change

`src/app/(site)/**`, `src/app/(next)/**` views and layouts, `src/app/welcome/**`, `src/components/**`, `src/ui/**`, `src/i18n/**`
(wording), `src/app/globals.css`, Tailwind config, `public/` images. Keep the existing `aria-*` labels and button texts the e2e suites use
(`Allow once`, `Create account`, `Sign in`, `Confirm`, …), or update the suites in the same change.
