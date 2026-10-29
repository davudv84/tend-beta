# Hosted demo for testers without GitHub

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

### Option A: Vercel Hobby + Neon Free, one project each (pending Vercel's answer on Hobby use)

From the `tend-beta` folder. The commands follow Vercel's CLI documentation and have **not** been run; check each project in the dashboard after
the first one. If Vercel offers to connect the GitHub repository, decline: CLI deploys need no Git connection, and the repository's `vercel.json`
turns Git deployments off anyway.

```bash
npm run beta:provision -- alice bob carol        # beta-envs/<name>/vercel.env: a fresh token and payments key each, mode 600, git-ignored
# Neon: create one project per tester (tend-beta-alice, ...), same region; paste each POOLED connection string as DATABASE_URL= in that tester's file
npm run beta:check                               # refuses shared databases, shared tokens, a public or demo instance, local-only settings
npx vercel login
for n in alice bob carol; do
  npx vercel project create tend-beta-$n                                              # a new project in your Hobby account
  npx vercel link --yes --project tend-beta-$n                                        # this folder now deploys to it
  while IFS='=' read -r k v; do case "$k" in ''|\#*) continue;; esac; printf %s "$v" | npx vercel env add "$k" production; done < beta-envs/$n/vercel.env
  npx vercel deploy --prod --regions fra1                                             # one region on Hobby: pick the one next to Neon
done
npm run beta:live -- alice=https://tend-beta-alice.vercel.app bob=https://tend-beta-bob.vercel.app carol=https://tend-beta-carol.vercel.app
```

`beta:live` checks HTTPS, the security headers, that a visitor sees nothing, the session cookie flags, and that every instance refuses every
other's key and session. Then open each address yourself once and run the sample agent. Limits: Hobby has no gate in front of the sign-in page,
so the token is the only lock; the file tools cannot run on serverless hosting (the sample agent and the guided test do not need them).

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
