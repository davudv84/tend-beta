# Hosted demo for testers without GitHub

> **Now recommended instead:** one shared instance with an account and an isolated workspace per tester, approved by you: `docs/private-beta.md`.
> The three-instance setup below still works (an instance without mail settings has no accounts).

Each tester gets **their own private TEND** at its own address, with its own database, its own sign-in token and fictional data only. They use it
in a browser: no GitHub account, no source code, no API key, nothing to install. Nothing is shared between testers, so nobody can see anyone
else's data. In each instance the tester is the only operator.

## What a tester does (about 3 minutes)

1. Open the address you sent, paste the sign-in token you sent separately, press Enter.
2. **Integrations** -> "Try it without code: the sample agent" -> **Run the sample agent**. A simulated agent asks TEND for three harmless,
   fictional actions: reading a note is **allowed** and runs, deleting a record is **refused** and never runs, sending an email **waits for you**.
3. **Approvals** -> read the exact email text -> **Allow once** (or **Don't allow**).
4. Back on **Integrations** -> **Let it continue**: an allowed email runs once; a refused one never does.
5. **Activity** shows everything TEND recorded. **Policies** lets them change the sample agent's rules (for example email = never) and run it again.

Nothing real happens: the sample agent only records that an action "ran". It is decided by the same policy engine, approval queue and audit log
as a real agent (tests: `src/server/sample-agent.test.ts`). Testers who want to connect a real agent use the Integrations page's guided test or
`docs/api-examples.md`.

## What testers can and cannot reach

- Signed out: nothing (`sign_in_required` / `operator_required`). The instance is private (`TEND_PUBLIC=0`) with no seeded demo agents (`TEND_DEMO=0`).
- Signed in with **their** token: their instance only. Another tester's token, session or agent key is refused by every other instance
  (`npm run beta:local:rehearse` and `npm run beta:live` check this).
- Never shown: admin tokens (they type their own; it is never displayed), the sample agent's key (it is never handed out), any API key.

## Deploying (needs your approval; nothing here has been run)

Choose one. Both give three isolated instances; neither touches the original repository or its Vercel project.

### Option A: Vercel Hobby + Neon Free, one project each (pending Vercel's written answer on Hobby use)

Checked 2026-10-29 against Vercel's and Neon's own pages:

- **Cost:** Hobby and Neon Free are $0 and need no card. Going over a Hobby limit pauses that feature for up to 30 days, and over a Neon limit
  suspends compute or blocks writes. Neither charges. Hobby limits are shared by **every project in the account**, including any other site you run there.
- **Fit:** three projects of 200 allowed and three databases of 100. TEND's use is small: the dashboard polls every 2.5 s only while its tab is
  visible, which is a few thousand requests per tester-hour against 1,000,000 invocations and 4 Active CPU-hours a month (shared, see above).
  Neon gives 100 compute-hours and 1 GB per project; its computes sleep after 5 minutes, so the first request after a pause is a little slower.
- **Use:** Hobby is "non-commercial personal use only"; commercial means "financial gain of anyone involved in any part of the production".
  Vercel says to ask Support if unsure. Neon calls Free "for prototypes, side projects, and small teams" and does not restrict commercial use.
- **No outer gate:** Hobby allows one Shareable Link and one external user per account, so Vercel Authentication cannot admit three outside testers.
  Leave Deployment Protection at its default (it protects preview URLs, not the production address) and do **not** pick "All Deployments".
  Each tester's own sign-in token is the lock.

Prepared locally (git-ignored, mode 600; already done): `beta-envs/tend-beta-e1ij7uel`, `beta-envs/tend-beta-n2xls5ff`, `beta-envs/tend-beta-g76aydi6`,
each with its own admin token and payments key. The random names make the addresses hard to guess. To make them again: `npm run beta:provision -- <names>`.

1. **Neon** (console.neon.tech, Free plan): create three projects with exactly those names, all in one region (for example AWS Europe Central,
   Frankfurt). For each, copy the **pooled** connection string (its host contains `-pooler`) into `DATABASE_URL=` in that name's `vercel.env`.
2. `npm run beta:check` must print no FAIL (it refuses a shared database, a shared token, a public or demo instance).
3. **Vercel**, from the `tend-beta` folder. These commands follow Vercel's CLI documentation and have **not** been run; check the first project in
   the dashboard before doing the other two. If Vercel offers to connect the GitHub repository, decline: a CLI deploy needs no Git connection, and
   the repository's `vercel.json` turns Git deployments off anyway.

```bash
npx vercel login
for n in tend-beta-e1ij7uel tend-beta-n2xls5ff tend-beta-g76aydi6; do
  npx vercel project create $n
  npx vercel link --yes --project $n
  while IFS='=' read -r k v; do case "$k" in ''|\#*) continue;; esac; printf %s "$v" | npx vercel env add "$k" production; done < beta-envs/$n/vercel.env
  npx vercel deploy --prod --regions fra1          # one region on Hobby: the one next to your Neon region
done
rm -rf .vercel                                    # this folder stays linked to nothing
npm run beta:live -- t1=https://tend-beta-e1ij7uel.vercel.app t2=https://tend-beta-n2xls5ff.vercel.app t3=https://tend-beta-g76aydi6.vercel.app
```

`beta:live` checks HTTPS, the security headers, that a visitor sees nothing, the cookie flags, and that every instance refuses every other's key
and session. Then open each address yourself once and run the sample agent. The file tools cannot run on serverless hosting; the sample agent and
the guided test do not need them.

If Vercel says no: Render's free web services (750 hours a month per workspace, asleep after 15 minutes idle, "do not use them for production")
can run the same server with the same Neon databases, or use Option B below.

### Option B: your own computer + Cloudflare Tunnel and Access (free; needs a domain on Cloudflare)

```bash
npm run build
npm run beta:local -- provision alice bob carol  # beta-envs/<name>/local.env and beta-data/<name>/, private, git-ignored
npm run beta:local -- check
npm run beta:local -- tunnel-config yourdomain.com   # prints the cloudflared config for alice/bob/carol.yourdomain.com
# Cloudflare Zero Trust (Free): one Access application per tester, allowing only that tester's email (one-time PIN)
npm run beta:local -- start                      # the three instances (OS-confined on macOS); keep running
cloudflared tunnel run tend-beta                 # makes them reachable; keep running
```

This adds a second lock (Cloudflare's email check) in front of each instance. It works only while your computer is on and both commands run.

### Then, for either option

Send each tester **two separate messages**: the address, and their token (from `beta-envs/<name>/`), never together. Send `docs/feedback-template.md`.
At the end: delete the three Vercel and Neon projects (Option A) or `beta-data/` and `beta-envs/` (Option B). That deletes every tester's data.

## Security limitations

- One sign-in token per instance; no accounts, no multi-factor sign-in of its own (Option B adds Cloudflare's email check).
- The sample agent is simulated. It shows how decisions are made, not that a real agent cannot bypass TEND: real agents that hold their own
  credentials can (see `docs/security-limitations.md`).
- No independent security review. Fictional data only.
