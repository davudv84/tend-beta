# Runbook: rotating secrets

Rotate on a schedule (every 90 days), at once when someone with access leaves, and immediately on any suspicion. Never paste a secret into a
ticket, chat or commit. Set values only in the hosting provider's secret store (Vercel project settings → Environment Variables), per environment:
production and preview must never share a value. After changing an environment variable on Vercel, **redeploy**: running instances keep the old one.

What each rotation ends is stated from the code, and the tests that prove it are named.

| Secret | Where | What rotating it does | How |
|---|---|---|---|
| `TEND_ADMIN_TOKEN` | Vercel env | Ends **every** admin session at once; putting the old token back does not revive them (`session.ts` epoch; `session.test.ts`) | Generate ≥32 random characters (`openssl rand -base64 36`), set, redeploy, sign in again |
| `TEND_ADMIN_TOTP_SECRET` (optional second factor) | Vercel env + the admin's authenticator app | Turning it on, changing it, or removing it ends every admin session (`admin-mfa.test.ts`). An unusable value disables admin sign-in rather than skipping the factor | `openssl rand 20 \| base32`, set, redeploy, add to the app (most accept the base32 text; or a `otpauth://totp/TEND:admin?secret=…&issuer=TEND` URI), sign in with token + code |
| Agent API keys (`tend_sk_…`) | Held by each agent | The old key stops at once; anything it had waiting for approval is cancelled (`agent-keys.test.ts`, `e2e:enforcement`) | Dashboard → agent → New key, or `POST /api/v1/agents/{id}/keys`; `DELETE` revokes without a replacement. After a suspected compromise of an account, rotate keys too: a password reset does not touch them |
| Account passwords | People | A reset signs out every session of that account, not other accounts (`e2e:accounts`) | Forgot-password flow |
| `DATABASE_URL` password | Neon (or your PostgreSQL) + Vercel env | Old password refused by the database once changed | Neon console → Roles → reset password (or `ALTER ROLE … PASSWORD`), update `DATABASE_URL` with `sslmode=require` (TEND upgrades it to `verify-full`), redeploy, check `/api/health` shows `"storage":"postgres"` and `"tls":"verify-full"` |
| `RESEND_API_KEY` | Resend + Vercel env | Old key stops sending mail; accounts are refused if mail cannot be sent | Create a new key in Resend, set, redeploy, send a password-reset to a test account, then delete the old key in Resend |
| `TEND_VAPID_PRIVATE_KEY` / `TEND_VAPID_PUBLIC_KEY` | Vercel env | Existing browser subscriptions stop receiving notifications; people turn notifications on again | `node scripts/vapid-keys.mjs`, set both together, redeploy |
| `TEND_CF_ACCESS_CLIENT_SECRET`, `TEND_PROTECTION_BYPASS` | Cloudflare Access / Vercel, if used | The service token or bypass stops working | Rotate in that provider first, then set here and redeploy |
| `TEND_GATEWAY_PAYMENTS_KEY` | Vercel env | The fake payments API used by the demo gateway; no real money | Any long random value |

**After any rotation:** sign in as the admin and look at Settings → sessions; run `npm run tend -- audit-verify --checkpoint …` with the last
checkpoint you kept, and keep the new one it prints.

**Not automated, needs the hosting accounts:** the Vercel and Neon steps above. Nothing in this repository can change them.
