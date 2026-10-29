# What TEND protects, and what it does not

Read this before you put anything real behind TEND. This beta is for controlled testing with fictional data.

## What it does (tested)

- **Asks before acting.** An action wrapped with TEND runs only after TEND allowed it, by a rule or by a person, and then only once, with exactly the
  tool, action, resource and text that were approved. A changed request, a reused approval, an expired one or a revoked key is refused.
- **Fails closed.** If TEND cannot be reached, answers with an error, or its database is unavailable, the protected action does not run.
  An unreadable rule set denies everything.
- **One policy for many agents.** A central policy applies to every agent assigned to it from the moment it changes, including requests already
  waiting or approved. An agent's own rules can make a centrally governed action stricter, never looser.
- **Looks at arguments.** A rule can depend on what the tool is called with (`when`: e.g. an email only to `example.com` addresses, a refund up
  to 50, a file only inside `/data/reports`). The approval is bound to those exact arguments; a missing or malformed argument never satisfies a
  condition, so "allow when … + deny everything else" fails closed.
- **Runs each authorized call at most once.** Allowed calls are authorized and spent in one step; a retry after a lost answer, or the same
  tool-call id delivered twice, is refused rather than run again.
- **Keeps a record.** Requests, decisions, policy changes and revocations are written to an append-only log in the same transaction as the change.
  Each entry is hash-chained to the one before it, so a changed, removed or inserted entry shows up when the chain is checked (`npm run tend -- audit-verify`).
  Visitors of a public instance see only the shape of activity, never rules or request contents.
- **Separate identities.** Each agent has its own key; revoking one does not affect another, and no agent can see or use another's approvals.

## What it does not do

- **It only controls code that asks it.** TEND is a checkpoint your agent calls, not a sandbox. An agent that skips the wrapper, or holds the real
  credentials for an email account, a database or a payment API, can act without TEND, and TEND will not know. For real enforcement the credential
  must live behind TEND (its gateway) or in a service that requires TEND's approval.
- **Same machine, same user.** Processes running as your user can read each other's environment (`ps eww`) and files. On macOS
  `npm run agents:confined` reduces this for the example agents; it is not a general isolation boundary.
- **Accounts without roles or multi-factor sign-in.** Each account has one workspace and everyone in it is an operator. No SSO, no 2FA, no teams.
  The admin token (for approving accounts) is one shared secret.
- **The agent tells TEND what it is about to do.** Conditions are checked against the arguments the agent sends. TEND's adapters send exactly the
  arguments the tool then receives, but a modified or malicious agent could describe one call and make another. Only a tool that itself checks
  TEND's decision closes that, and TEND does not offer that yet.
- **Conditions see summaries of long values.** Strings over 256 characters and lists over 50 items reach the rules as a hash and a length, so a
  condition on them does not match (the request falls through to the next rule). String comparisons ignore case.
- **The hash chain detects tampering, it does not prevent it.** Someone who can write to the database can rewrite history and recompute the chain.
  Keep the head hash that `audit-verify` prints somewhere outside TEND and compare it later.
- **It cannot judge what a request means.** It binds an approval to exactly what was asked; if your code describes one thing and does another,
  TEND cannot tell. People approving can be tired or misled by the text they are shown.
- **At most once, not exactly once.** If an agent crashes after spending an approval, the action ran zero times and only a missing report shows it.
- **No rules over sequences of calls** (e.g. "after reading private data, no outbound email"), no content scanning, no prompt-injection detection.
- **Protection checks** on the Verification page say "not verified" for agents under a central policy.
- **No independent security review, no availability guarantees, no notifications.** The dashboard must be open to see what waits for you.
- **Measured locally only.** Latency and throughput figures (docs/benchmark.md) come from one machine with an embedded database; a hosted TEND
  adds a network round trip per request (two per protected call, three after an approval).

## If you find a problem

Do not test against other people's systems or real data. Tell the TEND team privately with the steps to reproduce it; please do not post it publicly.
