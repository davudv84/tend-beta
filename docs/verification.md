# Verified Protection (v1)

Tend should never say an agent is protected unless it has evidence for the specific claim. This page defines what the
protection checks prove, what they do not, and how the checks themselves are tested.

**There is no overall rating.** No total, no score and no "protected" label exists anywhere, and a test fails the build if the
interface text introduces one. A successful test of Tend's gateway is never evidence that an agent, or the computer it runs on,
is safe.

## The three statuses

Each applies to **one stated claim**, never to the agent as a whole.

| Status | Meaning |
|---|---|
| **Verified** | Tend itself checked this specific claim (on this server now, or in a private test) and it held. |
| **At Risk** | Tend found evidence that the claim is false, or that protection is weaker than configured. |
| **Not Verified** | Tend cannot check it, could not run the check, or has no evidence either way. It never means "safe". |

## Where the evidence comes from

| Kind | What it is | Can it be Verified? |
|---|---|---|
| **Checked on this server now** (live) | Tend's own settings, the *permissions* of the notes folder, and Tend's own recorded history. Read-only. | Yes, for the exact claim, at that moment |
| **Tested on a private copy** (isolated) | Tend's gateway code run on a throwaway in-memory copy with invented data, using the agent's real rules | Yes, for the exact claim, and only about Tend's gateway |
| **Reported by the agent** | Anything the agent says about itself | No. Not used in v1 |

## The checks

Live (read from this server):

1. **The notes folder is closed to other accounts on this computer.** Owner is the account running Tend and no group or other
   permission bits are set. Only the folder's permissions are read (`lstat`), never its listing or contents.
   *Does not show:* whether the agent runs under the same account, ACLs or root access, or anything else that can reach it.
2. **Tend raises an alert if this agent says it acted without asking.** The enforcement setting is "enforce". Monitor-only is At Risk.
3. **Every action that needed approval had one.** Over the last 500 used authorizations, each action that needed approval has a recorded
   approval made before it ran. Nothing yet, or nothing that needed approval, is Not Verified.
4. **Each approval was used only once.** In Tend's own record.
5. **Whether the agent has ever reported acting outside Tend.** A report of an unapproved, repeated or changed action is At Risk.
   **No report is Not Verified, never Verified:** an agent that skips Tend would report nothing.

Tested on a private copy (with the agent's current rules):

6. **Tend refuses what your rules forbid.** Each forbidden tool is requested; each is denied, queues nothing, and a forged or missing
   pass runs nothing.
7. **Tend refuses made-up actions, hidden folder paths and web addresses.**
8. **Actions set to "Ask me first" wait for a person.** Held, no pass handed out, forged or missing pass runs nothing.
9. **A rejected action never runs.**
10. **An approval works once, and only for what was approved.** A wrong pass, a changed request, another agent, a second use and use
    after expiry are all refused; the approved action ran exactly once.

Beyond what Tend can see (always Not Verified, and says why):

11. **Your agent can't open the notes folder or hold Tend's credentials.** Tend cannot see where the agent runs. Only you, or whoever
    runs it, can confirm this.

The panel also lists, as a plain fact about the settings (not a check), which tools run without asking.

## What a pass does not mean

- It does not show that every possible bypass is closed. The private copy tests the cases listed, with invented data.
- It does not test your live database. The private copy runs the same code with the same rules, not the same instance. Overlapping
  requests on a real database are covered by automated tests on PostgreSQL (`npm run test:postgres`), not re-checked per run.
- It says nothing about the agent's own process: its credentials, files, network, shell or other tools.
- Custom rules (resource prefixes, permissions, several rules for one tool) are not tested; those tools are listed as not tested.
- Results go out of date when the agent's settings change; the panel says so.

## How it never touches real data

- The live checks read the database inside a transaction the database itself holds read-only, behind a filter that refuses writes and
  side-effecting functions. They look at the notes folder with `lstat` only.
- The private copy gets nothing real: a new in-memory database, a new temp folder, a made-up payments key and a throwaway probe agent.
  The only input is the list of rules. The gateway's folder and key are replaced for that code only (`AsyncLocalStorage`), so real
  requests in the same process keep using the real ones.
- A run writes exactly two records of its own: its result (`verification_runs`, append-only) and an audit event with counts only.
- Results contain no path, key, token or note name or text. Results and `verification.run` events go to operators only.

## Fail closed

Unreadable rules, a timeout, a crashing probe, a tool that isn't set up and a startup failure all produce **Not Verified**. If a probe
sees something wrong and then cannot continue, the finding is kept and reported as **At Risk**.

## How the checks themselves are tested

- `src/server/verification.test.ts`: statuses on a typical agent; tampered records (missing approval, an approval used twice, an
  outside report); fail-closed cases; read-only enforcement; unchanged rows, folder and environment; a folder it may not list; real
  requests unaffected while a run is in progress; no secrets in results; static guards on what the live module and the private copy
  may import or touch.
- **The verifier is tested by breaking the gateway.** Twelve deliberately broken gateways (forbidden request not denied, forged / missing /
  wrong pass accepted, made-up action or hidden path accepted, pass handed out too early, rejection ignored, second use, changed request,
  another agent, expired pass) must each turn the matching check At Risk. The same was done once against the real source (unknown
  tools allowed, "ask" treated as allow, token not checked, expiry ignored, text not bound, rejection approving, authorization skipped,
  paths accepted). One blind spot found this way (a wrong pass on an *approved* request) was closed.
- `src/i18n/protection-wording.test.ts`: no text claims safety, security or a guarantee, in English or German; exactly three statuses.
- `src/server/disclosure.test.ts`: visitors and signed-out users cannot read policies, enforcement settings, operator session ids, key
  fragments or verification results.
- `src/server/postgres.test.ts`: the same on real PostgreSQL.

## Limits of v1

- Only the notes tools and the built-in test and payment tools are probed. A tool added later needs a probe added, or it is not tested.
- Runs synchronously (a few seconds) and uses an in-memory PGlite database, which has not been verified inside a serverless function.
  If it can't start, the isolated checks are Not Verified.
- There is no scheduled or automatic run, no history view and no notification yet.
