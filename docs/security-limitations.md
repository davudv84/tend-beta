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
  to 50, a file only inside `/data/reports`). The approval is bound to those exact arguments; a missing, wrongly typed or empty argument is treated as unknown (not as "no match"): a deny or approve rule that might match applies, an allow rule
  does not, so "allow when … + deny everything else" fails closed and "approve when amount > 50" cannot be stepped around by sending `"5000"` or leaving `amount` out.
  Text rules (`contains`, `startsWith` …) on a deny list are still easy to rephrase (`rm  -rf`); write allow-lists, not deny-lists.
- **Runs each authorized call at most once.** Allowed calls are authorized and spent in one step; a retry after a lost answer, or the same
  tool-call id delivered twice, is refused rather than run again.
- **Keeps a record.** Requests, decisions, policy changes and revocations are written to an append-only log in the same transaction as the change.
  Each entry is hash-chained to the one before it, with its own sequence number bound into the hash, so a changed, removed or inserted entry shows up when the chain is checked (`npm run tend -- audit-verify`).
  The command prints a **checkpoint** (first and head sequence numbers and hashes) to keep outside TEND; passing it back on a later run (`--checkpoint …`) also catches a deleted prefix of the log or an altered oldest entry, which a bare walk and a kept head hash alone would miss.
  Visitors of a public instance see only the shape of activity, never rules or request contents.
- **Separate identities.** Each agent has its own key; revoking one does not affect another, and no agent can see or use another's approvals.

## What it does not do

- **It only controls code that asks it.** TEND is a checkpoint your agent calls, not a sandbox. An agent that skips the wrapper, or holds the real
  credentials for an email account, a database or a payment API, can act without TEND, and TEND will not know. For real enforcement the credential
  must live behind TEND (its gateway) or in a service that requires TEND's approval.
- **Same machine, same user.** Processes running as your user can read each other's environment (`ps eww`) and files. On macOS
  `npm run agents:confined` reduces this for the example agents; it is not a general isolation boundary.
- **Accounts without roles or multi-factor sign-in.** Each account has one workspace and everyone in it is an operator. No SSO, no 2FA, no teams.
  The admin token (for approving accounts) is one shared secret. Confirming an address needs the link and the password chosen at sign-up, so
  signing up first with someone else's address gains nothing. A password reset signs every session out but leaves agent keys working:
  after a suspected compromise, also revoke the keys of agents you did not create.
- **The agent tells TEND what it is about to do.** Conditions are checked against the arguments the agent sends. TEND's adapters send exactly the
  arguments the tool then receives, but a modified or malicious agent could describe one call and make another. Only a tool that itself checks
  TEND's decision closes that, and TEND does not offer that yet.
- **Shell rules match the words of a command, not what it does.** Balanced **v1** (saved before November 2026) asked only before commands whose
  text names `git push`, `rm `, `curl `, `sudo ` and similar, so a reworded command ran unasked: `git -C . push`, `find … -delete`,
  `python3 -c "…urlopen…"`, `cat ~/.ss?/id_rsa`. A saved v1 policy keeps those rules until someone saves the preset again (the dashboard says so).
  Balanced **v2** asks before every shell command except a few read-only ones written plainly (no `; & | $` and so on); Strict asks before every
  one. Even v2's short allow-list is a text match: it is chosen so that a command starting that way cannot do more than read, and anything that
  could chain, redirect or substitute asks. `src/lib/agent-presets.test.ts` lists the cases, and docs/presets.md the versions.
- **Conditions see summaries of long values.** Strings over 256 characters and lists over 50 items reach the rules as a hash and a length. A
  condition on such a value (or on an object where a plain value belongs) is treated as unknown: a deny or approve rule that might match
  applies, an allow rule does not, so padding or reshaping an argument can make a request stricter, never looser. String comparisons ignore
  case; numbers and text are compared as text (1001 and "1001" are the same value).
- **The hash chain detects tampering, it does not prevent it.** Someone who can write to the database can rewrite history and recompute the chain.
  Keep the **checkpoint** that `audit-verify` prints somewhere outside TEND and re-check against it (`--checkpoint …`): a rewrite up to that point, a deleted prefix, or an altered oldest entry no longer matches what you kept. Without a kept checkpoint, a full rewrite-and-recompute by a database owner is still undetectable.
- **It cannot judge what a request means.** It binds an approval to exactly what was asked; if your code describes one thing and does another,
  TEND cannot tell. People approving can be tired or misled by the text they are shown.
- **At most once, not exactly once.** If an agent crashes after spending an approval, the action ran zero times and only a missing report shows it.
- **No rules over sequences of calls** (e.g. "after reading private data, no outbound email"), no content scanning, no prompt-injection detection.
- **Protection checks** on the Verification page say "not verified" for agents under a central policy.
- **No independent security review, no availability guarantees, no notifications.** The dashboard must be open to see what waits for you.
- **Measured locally only.** Latency and throughput figures (docs/benchmark.md) come from one machine with an embedded database; a hosted TEND
  adds a network round trip per request (two per protected call, three after an approval).

## Added by the security verification (see SECURITY-VERIFICATION.md)

- **Approvers see every argument.** A pending request now lists all of its arguments (names and values, hidden or direction-changing characters
  shown as `<U+XXXX>`, long values cut and marked), not only the agent's one-line description. The description is still agent-written text.
- **A list that disagrees with itself is unknown.** `amount: [5000, 1]` against "approve when amount > 50" asks for approval (a tool that uses any
  one element must not get around a rule).
- **Agent keys can expire** (optional): `keyExpiresInDays` when registering or rotating a key, and `TEND_KEY_MAX_AGE_DAYS` as a server-wide cap. An expired key is
  refused like a revoked one, including for approvals it had in flight. Default: no expiry, as before.
- **Claude Code hooks installed per user or project can be switched off by the repository you open** (`disableAllHooks` in its own settings,
  or `--setting-sources user`; tested with real Claude Code). `install claude-code --managed` (administrator rights) puts them in Claude Code's
  organization settings, which a repository and the flags tried here cannot override (tested, 15 checks). `--bare` is untested and treated as a
  bypass. TEND cannot see an agent whose hooks are off: it is silent, not alarmed.

## If you find a problem

Do not test against other people's systems or real data. Tell the TEND team privately with the steps to reproduce it; please do not post it publicly.
