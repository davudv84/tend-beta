# Private beta: one hosted TEND, an account per tester

Testers sign up with their e-mail address, confirm it, and wait for you to approve them. Each account gets its own **workspace**: its agents,
agent keys, policies, approvals and activity log are visible and changeable only there. You, signed in with the admin token, approve accounts
and work in the default workspace, which does not see the testers' workspaces either. Agent API keys are a separate credential and work as before.

This replaces the three separate instances in `docs/hosted-demo.md` (which still work: an instance without mail settings simply has no accounts).
One deployment means one Vercel project and one Neon database.

## What to create (needs you; nothing here has been created)

| What | Where | Cost | What you get |
|---|---|---|---|
| A Neon project, e.g. `tend-beta` | console.neon.tech, Free plan | $0, no card | the **pooled** connection string (host contains `-pooler`) |
| A Resend account and a verified sending domain | resend.com, Free plan | $0, no card | an API key `re_…`; mail from an address on your domain |
| A Vercel project, e.g. `tend-beta` | the Vercel CLI (below) | $0 (Hobby) | `https://tend-beta.vercel.app` |

- **Resend needs a domain you control.** Verifying it means adding the DNS records Resend shows (SPF and DKIM). Its test sender `onboarding@resend.dev`
  delivers only to your own Resend address, so testers would get nothing: `npm run beta:check` refuses it. Free plan: 3,000 mails a month, 100 a day;
  TEND sends at most a few per tester.
- Vercel Hobby: Support confirmed in writing that this beta may run on Hobby.

Enter the values in `beta-envs/tend-beta/vercel.env` (already prepared: git-ignored, mode 600, with a fresh admin token and payments key). Open it in
an editor; never paste the values in a chat, a commit or a terminal history:

```
DATABASE_URL=        the Neon pooled connection string (ends with ?sslmode=require)
RESEND_API_KEY=      re_…
TEND_EMAIL_FROM=     TEND <beta@your-domain.com>
TEND_APP_URL=        https://tend-beta.vercel.app      (the exact address the project gets; no trailing slash)
TEND_ADMIN_EMAIL=    your address, to hear when someone waits for approval (optional)
TEND_ADMIN=0         optional: no admin and no approval step; confirming the e-mail address is enough (see .env.example)
TEND_EMAIL_VERIFICATION=0  optional: no confirmation e-mail; a new account signs in at once (see .env.example)
TEND_VAPID_PUBLIC_KEY / TEND_VAPID_PRIVATE_KEY / TEND_VAPID_SUBJECT
                     optional: browser notifications (`node scripts/vapid-keys.mjs` prints a pair). Without them notifications are
                     listed inside TEND only, and Settings says browser notifications are not set up.
```

A new account starts in the setup guide (`/welcome`): connect an agent, check the connection, set one rule and watch TEND decide a
real test action. It can be skipped, and restarted from Settings → Account. Accounts that already had a connected agent are not sent there.

Then `npm run beta:check` must print no FAIL. (It also checks the three older instances in `beta-envs/`; delete those folders if you use this one only.)

## Deploying (needs your approval)

From the `tend-beta` folder. Vercel's CLI, no Git connection (the repository's `vercel.json` turns Git deployments off):

```bash
npx vercel login
npx vercel project create tend-beta
npx vercel link --yes --project tend-beta
while IFS='=' read -r k v; do case "$k" in ''|\#*) continue;; esac; [ -n "$v" ] && printf %s "$v" | npx vercel env add "$k" production; done < beta-envs/tend-beta/vercel.env
npx vercel deploy --prod --regions fra1     # one region on Hobby: the one next to your Neon region
rm -rf .vercel
```

The database schema is created on the first request (migrations run inside TEND, one instance at a time). Then, yourself:

1. Open `https://tend-beta.vercel.app/operator`, sign in with the admin token from `vercel.env`.
2. In a private window, sign up at `/account/sign-up` with an address of yours, confirm it from the mail, approve it under **Beta access**,
   sign in, and run the guided test in **Connect an agent**. That is the whole tester path; about three minutes.
3. `npm run beta:live -- t1=https://tend-beta.vercel.app` checks HTTPS, the headers, that a visitor sees nothing and the cookie flags.

## Admin: approving testers

**Beta access** (in the sidebar when you are signed in with the admin token) lists every sign-up. An account can be approved only after its
address is confirmed; approving mails the person. **Disable** signs them out at once, stops their sign-ins, revokes every agent key in their
workspace and cancels anything waiting. **Enable** lets them sign in again; they issue new agent keys themselves.

## Sent to each tester

> You're invited to the TEND private beta: https://tend-beta.vercel.app/account/sign-up
>
> 1. Create an account with this e-mail address and confirm it from the mail (check spam).
> 2. I'll approve you; you'll get a second mail.
> 3. Sign in, open **Connect an agent**, pick **Anthropic** (or **HTTP API**), and follow the four steps. The last one gives you a one-line
>    command to run in a terminal (Node 18 or newer): it asks TEND to run a harmless test action, you approve it in the browser, and you see
>    the verified result. About five minutes.
> 4. Then follow docs/beta/integration-guide.md (attached): the sample agent, a policy with an argument rule, your own agent.
>    Feedback: reply with the questions in docs/beta/feedback.md; bugs: docs/beta/bug-report.md.

### The 5-minute integration test

| Minute | What the tester does | What they should see |
|---|---|---|
| 0–1 | Sign in, **Connect an agent**, choose Anthropic, name it, create it | Step 3: permissions, "Send a test ping" set to "Ask me first" |
| 1–2 | Save, continue, copy the command, run it in a terminal | "Waiting for you to approve it in the Tend dashboard…" |
| 2–3 | Approve in the browser | "Verified: Tend ran the test action"; the terminal prints `pong: hello from my agent` |
| 3–5 | **Activity**; **Policies**: set the test ping to **Never**, run the command again | The request is refused and never runs |

Measured locally on a production build: 89 seconds from sign-in to "Verified", about 3 minutes from opening the sign-up page (admin approval
included). Their own agent then uses the same key with one of the verified integrations (Integrations page; `docs/verification-report.md`).

### Bugs and feedback

- **Feedback:** reply by e-mail with the questions in `docs/beta/feedback.md` (and the setup times from the guide's measuring table).
- **Bugs:** `docs/beta/bug-report.md`: one mail per bug, subject `TEND bug: <one line>`, with: what you did (steps), what you expected, what happened, the time (with time
  zone), the page address, and a screenshot. From the browser: the error text on screen. From a terminal: the output, **with any `tend_sk_…`
  key removed**. Never send an API key or a password; nobody at TEND will ask for one.
- **Security issues:** mark the subject `TEND security` and do not post them anywhere else.

## Limits of this beta

- **Accounts:** e-mail and password only; no multi-factor sign-in, no single sign-on. Wrong passwords are limited per address and per account
  (20 an hour), so someone can lock one account out for an hour by guessing; the owner can reset the password, which ends the lockout's purpose.
- **One workspace per account**; no teams or sharing. The admin token's own workspace does not see testers' data, and cannot be used to read it.
- **Agents' own credentials:** TEND only controls what goes through it. An agent that holds real credentials and skips TEND is not stopped
  (`docs/security-limitations.md`).
- **The server-side file tools** (`TEND_GATEWAY_NOTES_DIR`, `TEND_GATEWAY_SANDBOX_DIR`) are one folder for the whole server, not per workspace:
  leave them unset on a shared instance (they cannot run on Vercel anyway). The guided test does not need them.
- **Adapters for testers:** TEND serves them itself: `/sdk/tend.mjs` (every JavaScript adapter and the MCP proxy, one file, no dependencies)
  and `/sdk/tend_gate.py` (Python, standard library). The Connect page shows the `curl` line; no access to this repository is needed.
- **Per-agent rate:** 120 authenticated requests a minute by default, about 30 protected calls (each makes four). Past that, calls are refused.
  `TEND_AGENT_RPM` raises it (10–10000).
- No independent security review. Ask testers to use fictional data only.
