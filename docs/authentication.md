# Authentication and access control

Status labels: **VERIFIED** (tested here, evidence named), **IMPLEMENTED BUT UNVERIFIED**, **NOT IMPLEMENTED**.

## Who can sign in

| Identity | How | Second factor |
| --- | --- | --- |
| Account (e-mail + password, scrypt) | `/account/sign-in` | TOTP, optional per account (below) |
| Platform admin | `TEND_ADMIN_TOKEN` (one shared secret, 32+ characters) | **none**; keep the token in a secret store and rotate it (`docs/operations.md`) |
| Agent | API key (`tend_sk_…`), one per agent, optional expiry. Sent only over https: every TEND client (SDK for JS and Python, hooks adapter, example agents) refuses a plain-http address other than `localhost`/`127.0.0.1`/`[::1]` before sending anything, and the hooks then block the tool call (**VERIFIED**, client tests) | n/a |

Sessions: server-side rows, cookie `__Host-` prefixed in production, 12 h for the admin token and 7 days for accounts, ended by sign-out, "sign out everywhere", a password
reset, turning on two-step sign-in (other sessions), account removal or disabling, and a changed admin token. **VERIFIED** (session tests, e2e).

## Workspace roles (**VERIFIED**)

`src/server/rbac.ts`. Every operator route declares the role it needs; `routes.test.ts` fails if a route does not, or needs something else.

| Role | May |
| --- | --- |
| viewer | read the workspace; own notification settings, own sessions, two-step setup |
| operator | + decide approvals, pause/resume agents, ask for check-ins, run and read protection checks, mark the workspace's notifications read, send test notifications |
| admin | + agents, keys, rules, central policies; invite and manage members up to admin |
| owner | + make and manage owners |

Rules: nobody assigns a role above their own, changes a member above their own role, or changes their own membership; a workspace keeps at least
one owner; the actor's role is read again inside the change's transaction (a demotion that just happened applies). Invitations
(`POST /api/v1/members`) are records of their own: a one-time link valid 7 days (`/account/accept`) creates the account in the workspace, with
the address confirmed; until then no account exists, so an invitation cannot claim an address or block it once withdrawn. The answer is the same
whether or not the address already has an account (no enumeration), and an existing account can never accept (accounts never move between
workspaces). Removal disables the account and ends its sessions; agents and keys stay with the workspace. Every change is in `auth_events`
(`member.invited` and `member.invite_revoked` against the inviter, the address only as a hash; `member.joined`, `member.role_changed`,
`member.removed`) with the acting session.

Evidence: `src/server/rbac.test.ts` RBAC-1…6; `redteam/live/rbac-matrix.mjs` (34 checks over HTTP on a production build, on PostgreSQL with RLS
and a restricted login, including two owners demoting each other concurrently); mutations M-19, M-20.

Limits: members are managed through the API only (no screen yet). Within a workspace, per-user rows (sessions, notification settings) are
separated by the application's `user_id` filters; row-level security separates workspaces, not members.

## Two-step sign-in (**VERIFIED** locally)

TOTP (RFC 6238) through **otplib 13.6.0** (`src/server/mfa.ts`); TEND implements no part of the algorithm.

- Setup and enable need the password again (a stolen session alone cannot put an attacker's authenticator on the account), then a first code →
  10 one-time recovery codes (stored as SHA-256 hashes). Off: password + code or recovery code. The account is mailed about every change.
- After 10 wrong codes in a day (a fixed daily window: at worst about 18 guesses across midnight) the second factor is locked until the owner
  resets the password by e-mail. The platform admin can remove a lost second factor (`/api/admin/users/<id>` `reset_mfa`), on record, and
  the account is mailed.
- The secret is sealed with AES-256-GCM under `TEND_MFA_KEY` (32+ characters); production refuses setup without it. A tampered row never signs
  anyone in.
- At sign-in the code is asked for only after the right password, and checked before the failed-attempt budget is refunded, so guessing codes
  is limited like guessing passwords (10 failures per address per minute, 20 per account per hour).
- A code works once (its time step is spent atomically); ±30 s clock tolerance.

Evidence: `src/server/mfa.test.ts` MFA-1…6 (the library against RFC 6238's published vectors; codes from an independent reference written in
the test), `scripts/mfa-e2e.mjs` (API + real Chromium sign-in on a production build on PostgreSQL), mutations M-21, M-22.
**Not tested:** real authenticator apps on phones (the format is the standard `otpauth://` one). The settings card's setup flow was not driven
in a browser (the API it calls was).

Not covered: two-step for the platform admin token; requiring two-step for a whole workspace; WebAuthn/passkeys.

## SSO (**NOT IMPLEMENTED**)

Design that fits the current code, for when it is built:

1. OpenID Connect with a certified client library (`openid-client`), authorization-code flow with PKCE, `state` and `nonce`, ID-token
   validation by the library.
2. A table `user_identities (issuer, subject, user_id)`: an account is found by `(iss, sub)`, never by e-mail alone.
3. Per workspace: the issuer, client id, the allowed e-mail domains, and "SSO required" (then password sign-in is refused for its members, and
   members are created only by invitation or by an admin-approved domain rule; no silent just-in-time provisioning into a workspace).
4. The IdP's MFA counts as the second factor; TEND's TOTP stays for password accounts.
5. SAML through a maintained library only if a customer needs it.

Testing it requires a real IdP (or a local OIDC test provider); nothing about SSO may be claimed before that.
