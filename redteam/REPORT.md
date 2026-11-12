# TEND red-team — findings

**Target:** `~/Documents/tend-beta` (the current product), run as a **local, non-production** instance
(`next dev -p 3200`, embedded PGlite, fake agents/data, scratchpad data dir). The deployed
`tend-beta-mauve` was never touched.
**Date:** 2026-11-12. **Scope:** brief sections A–E, against the site/docs' security claims.

## How this was tested (so you can re-run it)

1. **Code audit** of the enforcement core: `authz.ts`, `policy.ts`, `gateway.ts`, `audit-chain.ts`,
   `db.ts`, `session.ts`, `auth.ts`, `http.ts`, `repo.ts`, and the claim docs
   (`enforcement.md`, `security-limitations.md`, `audit.md`).
2. **Independent module-level attack harness** — `redteam/attacks.ts`, drives the *real* modules against
   a fresh in-memory DB, from scratch (does **not** reuse TEND's own tests). Run:
   `node --no-warnings redteam/attacks.ts` → **25 HELD, 0 BROKEN, 2 integrity GAPs**.
3. **Independent live HTTP harness** — `scratchpad/live-E.mjs`, real requests at `:3200`. →
   **10 HELD, 0 BROKEN**.
4. **Their own security suite** as a cross-check: 87/87 pass
   (`authz/audit-chain/revoke-race/protection-bypass/admin-token/tenancy/policy/gateway/session`).

Bottom line up front: **TEND does what it says.** Every guarantee the docs mark "tested" held under
independent attack. The docs are unusually honest — most of what a reviewer might call a "hole" is a
limitation TEND already discloses in `security-limitations.md`. There is **one genuine code-level gap**
(audit-chain, below), and it's narrow (needs DB-write access). I did not manufacture findings for the
rest; where something is unexploitable I say so.

---

## Findings, by severity

### 1 — MEDIUM · Audit log: the first event is an unverified "anchor", so prefix-deletion and oldest-event tampering are invisible — including to the external head-hash the docs recommend as the backstop

**What I tried.** Simulated a party with database write access (the exact threat the hash chain is *for*,
per `audit.md`). Two moves, each in its own transaction with the `tend.maintenance` flag raised:
(a) change the **oldest** surviving event's `data` without recomputing its hash; (b) `DELETE` the oldest
N events (a prefix of the log).

**Result: BROKEN (for this threat model).**
- `verifyAudit` recomputes each event's hash as `sha256(prevHash | id | agent | type | at | actor | data)`,
  but it treats the **first chained row as an anchor** and never checks the anchor's own hash against its
  content (`src/server/audit-chain.ts:23-24`). So tampering the oldest row's `data` passes
  (`D7: ok=true`), and because every later row chains off *stored* hashes, the recomputed **head hash is
  unchanged**.
- Deleting a prefix makes the next survivor the new anchor; the chain re-links, `verifyAudit` passes, and
  the head is again unchanged (`D8: ok=true, removed=2, headSame=true`).

**Why it matters.** `security-limitations.md` says "a changed, **removed** or inserted entry shows up when
the chain is checked," and `audit.md` offers the externally-kept head hash as the backstop against a
DB-level rewrite ("a history rewritten after that point no longer ends in the hash you kept"). Both
statements are **false for a prefix deletion or an oldest-event edit** — the head doesn't move, so the
documented mitigation silently misses it. An attacker with SQL access who wants to erase the *earliest*
evidence (the first malicious `policy.updated`, the first `authorization.consumed`) leaves no trace in
either `audit-verify` or your saved head hash. This is routine enough that the demo's own retention
prunes the oldest (simulation) events on every tick with exactly this flag — which is *why* the anchor is
unverified.

**Scope / honesty.** This needs database write access. `tend.maintenance` is set in only two places
(`demo.ts:154`, `demo.ts:177`), both demo-only, the reset one admin-gated — **no request path reaches
it**. So this is not remote. But it is a real mismatch between a documented guarantee and the code, in the
precise threat model the feature exists for, and the recommended mitigation doesn't cover it.

**Minimal repro:** `redteam/attacks.ts` section D (D7, D8).

**Fix (cheap):**
- Make `verifyAudit` detect prefix loss with the `seq` identity column: `seq` is `GENERATED ALWAYS AS
  IDENTITY`, so the lowest surviving `seq` only ever goes *up* when a prefix is deleted. Return the first
  `seq` and let the operator pin it alongside the head hash; a jump means the start was cut.
- Verify the **anchor** against an external record, not just the tail: have `audit-verify` take an expected
  `{firstSeq, firstHash}` checkpoint and fail if the anchor row's recomputed hash ≠ the pinned one.
- Include `seq` in the hashed content so position is bound, and periodically write a signed
  `(seq, hash)` checkpoint out-of-band. Then both "edit the oldest row" and "drop a prefix" change
  something you kept.

---

### 2 — LOW · `when` argument-limits silently never apply to gateway spend tools (safe, but misleading)

**What I tried.** Reasoned through whether an operator can bound gateway spend with policy, e.g.
`pay_invoice when amountCents lte 500`.

**Result: HELD (fail-closed) but a usability trap.** Gateway requests are built from `describe()` →
`{tool, action, resource, detail}` with **no `args`** (`gateway.ts` `requestExecution`/`bind`). A `when`
on `amountCents` therefore evaluates against a missing argument → "unknown" → an approve/deny rule drops
to "maybe" and the catch-all deny wins. So such a rule **denies everything rather than capping anything**.
That's the safe direction, and it matches the disclosed limit "Policy can't express limits such as up to
500 EUR." The risk is purely that an operator writing a custom `when` limit on a spend tool may believe
they set a ceiling that in fact never runs. Payments always require a human who reads the amount in
`detail` — which is the actual control.

**Fix:** reject (422) a saved rule whose `when` references an argument the named gateway tool never sends,
with a message pointing to the human-approval amount in `detail`. Or surface gateway amount as an `arg` so
`lte` can bind.

---

## HELD — attacked and did not break (independent evidence)

### A. Approval binding — all HELD
| # | Attack | Result |
|---|---|---|
| A1 | Replay a consumed approval | 409 `already_consumed` + `authorization_replay` alert |
| A2/A2b | Reuse approval with changed amount / payee | 403 `mismatch`, nothing runs, mismatch counter ++ (revokes at 3) |
| A3 | Consume after approval/token expiry | 403, refused to the millisecond |
| A4 | Agent A spends **agent B's** approval | 404 — another agent's id looks non-existent (also confirmed live, E3) |
| A5 | Race two concurrent consumes of one approval | exactly **one** wins (atomic single-UPDATE) |
| A5b | Two identical requests, one approval covers both | distinct ids, second stays pending — one approval ≠ two executions |
| A6 | `spendApproved` (one-round-trip) replay | 409 `already_consumed` |

### B. Rules & gateway — all HELD
| # | Attack | Result |
|---|---|---|
| B1 | Save `allow` on a "Never" tool (`pay_invoice`) | 422 `spend_requires_approval` |
| B1b | Plant `allow` straight in the DB, bypass save | still evaluated as **approve** (needs a person) |
| B2 | Tool-name tricks: `PAY_INVOICE`, trailing space, zero-width, Cyrillic look-alike, `*`, `../`, `;DROP` | all 404/422 (strict `ID` regex + allowlist `Object.hasOwn`) |
| B3 | Read the gateway credential from the agent side | never returned or logged; output allowlist strips the fake API's leaked `Bearer` debug field → only `{paymentId,status}` |
| B4 | Smuggle different params at execute than were approved | 403 `mismatch`, nothing paid |

### C. Fail-closed — HELD
| # | Attack | Result |
|---|---|---|
| C1 | Invalid/unreadable policy | deny all (`invalid_policy`) |
| C2 | Paused agent / disabled integration | deny |
| C3 | DB unavailable mid-consume | throws, **tool never runs** (0 new calls) |

### D. Log integrity — HELD except finding #1
| # | Attack | Result |
|---|---|---|
| D1/D2/D3 | Ordinary UPDATE / DELETE / TRUNCATE on `events` | all refused, SQLSTATE `42501` |
| D4 | Verify an untampered chain | ok |
| D5 | Full DB-owner rewrite **with** hash recompute | chain self-consistent (as documented) but external head hash **changes** → out-of-band detectable |
| D6 | Tamper a mid/last event, don't fix the hash | `audit-verify` detects the break |
| D7/D8 | Tamper the **oldest** event / delete a **prefix** | **GAP — see finding #1** |

### E. Auth & input (live HTTP) — all HELD
| # | Attack | Result |
|---|---|---|
| E1 | Missing / unknown / malformed agent key | 401 |
| E2 | Revoked key, retried | 401 immediately |
| E3 | Cross-agent IDOR: read/consume another agent's approval | 404 (and the owner can, 200) |
| E3b | Agent key hitting operator routes (policy/keys/state) | 403/401/405 |
| E4 | State-change route with no session / forged cookie | 403 |
| E4b | CSRF: cross-origin `Origin` / `Sec-Fetch-Site: cross-site` | 403 `bad_origin` |
| E5 | SQLi / path-traversal / oversize in tool,resource,detail,note-name | 422; DB intact afterwards |
| E7 | Default deny: new agent, no policy | 403 `no_policy` |

### F. Central policy — all HELD
| # | Attack | Result |
|---|---|---|
| F1 | Agent `allow` tries to loosen central `approve` | can't — request is pending (person decides) |
| F2 | Tighten central to `deny` **after** a token was issued | already-issued token refused at consume (403 `not_permitted`) |
| F3 | Unreadable central policy | deny all (fail closed) |

---

## Which public claims are backed by code

**Backed (independently verified):**
- "Asks before acting … only once, with exactly the tool/action/resource/detail approved; changed/reused/
  expired/revoked is refused." ✅ (A1–A6, B4, E1–E3)
- "Fails closed … unreachable/error/DB-down/unreadable-rules → does not run." ✅ (C1–C3, F3)
- "One policy for many agents; agents can tighten, never loosen; applies to in-flight requests." ✅ (F1–F3)
- "Looks at arguments; missing/malformed never satisfies a condition (fail closed)." ✅ (code + policy.test)
- "Runs each authorized call at most once." ✅ (A1, A5, A6)
- "Separate identities; revoking one doesn't affect another; no agent sees another's approvals." ✅ (A4, E2, E3, tenancy suite)
- Append-only log; ordinary UPDATE/DELETE/TRUNCATE refused. ✅ (D1–D3)
- Tokens: 256-bit, hashed at rest, single-use, atomic consume, 3 strikes revoke, cross-agent invisible,
  `detail` rejects control/zero-width/bidi chars. ✅ (A-series, code)
- Sessions: server-side, immediate revocation, HttpOnly/SameSite=Strict/`__Host-`, ≤12h. ✅ (their session suite, 87/87)

**Not fully backed yet (claim vs code mismatch):**
- "A **removed** entry shows up when the chain is checked" and the external-head-hash backstop against a
  DB rewrite — **false for a prefix deletion / oldest-event edit** (finding #1).

**Honestly disclosed, but a security reviewer will still push on these (they are real exposure):**
- Cooperative enforcement is the shipped example and is bypassable by a compromised agent; only the
  server-side **gateway** (or a target-side check) is a real boundary. Disclosed, but it's the default
  people will copy.
- Gateway spend has **no policy-expressible amount cap**; every payment leans on a human reading `detail`
  (finding #2).
- Single shared **admin token**, no per-person approver identity, no 2FA/SSO, no two-person rule.
- Stolen session cookie works up to 12h (or until rotate/sign-out-everywhere).
- Rate-limit/address trust is only as good as `TEND_TRUSTED_PROXY`; misconfig = spoofable buckets.
- Append-only depends on running the app as a **non-owner** DB role (deployment-dependent).

---

## Top 3 to fix before you show your security friend

1. **Close the audit-chain anchor/prefix gap (finding #1).** It's the only place code contradicts a
   stated guarantee, and it's in the audit trail — the thing a security person scrutinizes first. Add
   `seq`-contiguity + an external `{firstSeq, firstHash}` checkpoint to `audit-verify`, and bind `seq`
   into the hash. Cheap; removes the "your own docs say this is covered and it isn't" conversation.
2. **Make the strong path the default, not the example.** The headline promise ("runs only after TEND
   allowed it") is only true for the gateway/target-side credential model; the cooperative wrapper you
   ship as the example is explicitly *not* a boundary. Lead with the gateway in docs/quickstart and label
   the cooperative gate as demo-only, so nobody wires a compromised-agent-bypassable path thinking it's
   enforcement.
3. **Guard the operator against false-confidence limits on spend.** Reject `when` rules that reference
   arguments a gateway tool never sends (finding #2), and make the UI state plainly that gateway amounts
   are controlled by human approval of `detail`, not by policy. Pair with the already-disclosed "humans
   can be tired" caveat — that's the realistic attack on money movement here.

Everything else I threw at it held. This is a well-built, honestly-documented system; the gap list is
short on purpose.

---

## Update — all three recommendations implemented (2026-11-12)

All fixes landed and are verified. Test evidence below; re-run with
`node --no-warnings redteam/attacks.ts` (29 HELD, 0 BROKEN) and `node --test src/server/audit-chain.test.ts` (7 pass).

### Fix 1 — audit-chain anchor/prefix gap (finding #1) — CLOSED
- `seq` is now **bound into the hash chain** from a new migration forward (`db.ts` `events_chain` trigger v2); events
  already hashed keep their v1 hash, and `verifyAudit` applies the right formula per row using the boundary recorded in
  `meta['events.chain.v2_after']`. Verified to upgrade a real mixed v1/v2 database in place with **0 false gaps**.
- `verifyAudit` now returns and accepts an **external checkpoint** `{firstSeq, firstHash, head, headSeq}`
  (`src/server/audit-chain.ts`, `GET /api/admin/audit?firstSeq=…`, `npm run tend -- audit-verify --checkpoint …`).
  `firstHash` is a predecessor-independent content hash of the anchor, so the oldest event is pinned.
- **Contiguity** is reported (`gaps`) and becomes a hard failure before a kept head; it is deliberately *not* a bare
  hard-fail, because a rolled-back transaction can legitimately burn a `seq` (e.g. `expireStale` writing an expiry event
  before a `too_many_pending` throw) — a bare contiguity check would false-alarm.
- New tests prove the acceptance criteria: **editing the oldest event** and **deleting a prefix** are now detected with a
  kept checkpoint (and a bare walk without one still can't — the documented, unavoidable part), plus an interior
  delete-and-recompute is caught, and the v1→v2 boundary verifies.
- Harness: D5b / D7b / D8b now show the checkpoint catching the full rewrite, the altered oldest event, and the prefix
  deletion respectively.

### Fix 2 — gateway is the documented default; cooperative wrapper labelled less-secure — DONE
- `docs/enforcement.md` leads with the gateway as the **recommended default** ("use it for anything that moves money or
  touches a real system") and marks the `examples/claude-agent/` cooperative wrapper as demo-only, *not* a boundary.
- Site security/how-it-works copy (`src/i18n/en.ts`, `de.ts`): the two modes are reordered to **Gateway — recommended**
  first and **Checkpoint — cooperative, less secure** second, with matching wording.

### Fix 3 — reject `when` limits on gateway spend tools; UI states human-approval control — DONE
- `policy.ts` `policyProblem` now **refuses (422)** a `when` condition on a spend tool (`NEVER_AUTOMATIC`), because a
  gateway request carries no raw arguments so the limit could never apply. Enforced on agent and central policy saves.
  Verified live: `POST …/policy` with `when:{amountCents:{lte:500}}` on `pay_invoice` → 422.
- The permissions screen's spend hint (`spendLocked`, en/de) now states the amount is **confirmed by the approver each
  time and cannot be capped by a rule**.

### Verification run
- `redteam/attacks.ts`: **29 HELD, 0 BROKEN** (A–F, incl. B1c when-refusal and D5b/D7b/D8b checkpoint detection).
- `redteam`/live HTTP (`scratchpad/live-E.mjs`): **10 HELD, 0 BROKEN**; audit-verify over HTTP on the upgraded v1/v2 DB
  is `ok` with 0 gaps, round-trips its checkpoint, and rejects a wrong checkpoint.
- Full server suite (`node --test src/server/*.test.ts`): **382 pass, 0 fail** (20 Postgres-only skipped).
- Docs updated: `security-limitations.md`, `enforcement.md`, `audit.md`, plus the site security page strings.
