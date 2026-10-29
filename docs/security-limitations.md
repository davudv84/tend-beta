# What TEND protects, and what it does not

Read this before you put anything real behind TEND. This beta is for controlled testing with fictional data.

## What it does (tested)

- **Asks before acting.** An action wrapped with TEND runs only after TEND allowed it, by a rule or by a person, and then only once, with exactly the
  tool, action, resource and text that were approved. A changed request, a reused approval, an expired one or a revoked key is refused.
- **Fails closed.** If TEND cannot be reached, answers with an error, or its database is unavailable, the protected action does not run.
  An unreadable rule set denies everything.
- **One policy for many agents.** A central policy applies to every agent assigned to it from the moment it changes, including requests already
  waiting or approved. An agent's own rules can make a centrally governed action stricter, never looser.
- **Keeps a record.** Requests, decisions, policy changes and revocations are written to an append-only log in the same transaction as the change.
  Visitors of a public instance see only the shape of activity, never rules or request contents.
- **Separate identities.** Each agent has its own key; revoking one does not affect another, and no agent can see or use another's approvals.

## What it does not do

- **It only controls code that asks it.** TEND is a checkpoint your agent calls, not a sandbox. An agent that skips the wrapper, or holds the real
  credentials for an email account, a database or a payment API, can act without TEND, and TEND will not know. For real enforcement the credential
  must live behind TEND (its gateway) or in a service that requires TEND's approval.
- **Same machine, same user.** Processes running as your user can read each other's environment (`ps eww`) and files. On macOS
  `npm run agents:confined` reduces this for the example agents; it is not a general isolation boundary.
- **One shared admin token.** There are no user accounts, roles or per-person approvals: everyone with the token is "the operator". Approvals record
  the session that made them, not the person. No multi-factor sign-in of its own.
- **It cannot judge what a request means.** It binds an approval to exactly what was asked; if your code describes one thing and does another,
  TEND cannot tell. People approving can be tired or misled by the text they are shown.
- **At most once, not exactly once.** If an agent crashes after spending an approval, the action ran zero times and only a missing report shows it.
- **Policies cannot express limits** such as "up to 500 EUR"; amounts live only in the text a person reads.
- **Protection checks** on the Verification page say "not verified" for agents under a central policy.
- **No independent security review, no availability guarantees, no notifications.** The dashboard must be open to see what waits for you.

## If you find a problem

Do not test against other people's systems or real data. Tell the TEND team privately with the steps to reproduce it; please do not post it publicly.
