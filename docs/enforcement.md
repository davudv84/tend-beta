# Pre-execution authorization: integrating an agent

Tend can answer **"may this agent do this, now?"** before a sensitive tool runs, and keep a record of the answer.
This page is for developers connecting their own agent. It describes what is built, how to use it, and, just as
important, what it cannot do.

## What this is, and what it is not

Tend authorizes. **Your integration enforces.** Tend never touches your tools, so it can only stop an action if the code
that performs it asks first and obeys the answer.

- An agent whose code skips the check, or that holds the real credentials itself (an API key in its environment, a
  database password, a payment token), **can bypass this entirely**. Tend can then only *detect* it after the fact,
  and only if the agent reports it.
- Enforcement is real only when the credential that performs the action is **not** held by the agent: it lives in a tool
  gateway, an MCP proxy or the target service, and that component refuses to act without a consumed authorization.
  **This gateway model is the recommended default — use it for anything that moves money or touches a real system.** See
  [gateway.md](gateway.md).
- The example in `examples/claude-agent/` is the **cooperative** form, a wrapper inside the agent's own process. It is
  quick to add and fine for a demo or an agent you already trust, but it **demonstrates the protocol; it is not a security
  boundary against a compromised agent** — one that skips the wrapper, or holds the credential itself, acts without TEND.
  Do not rely on it for real enforcement; put the credential behind the gateway instead.

## The flow

```
1. POST /api/v1/authorizations            ask: { tool, action, resource?, detail? }
        → 201 approved | 201 pending | 403 denied (reason code) | 200 repeat of an earlier request
2. POST /api/v1/authorizations/{id}/token wait: 202 pending … 200 { token } once approved; 403 if rejected, expired, cancelled
3. POST /api/v1/authorizations/{id}/consume  spend: { token, tool, action, resource?, detail? } → 200 { authorized: true }
4. …only now perform the action…
5. POST /api/v1/events   tool.called { …same fields, outcome, authorizationId }   report what happened
```

Also: `GET /api/v1/authorizations/{id}` (status, never a token) and `POST /api/v1/authorizations/{id}/cancel`.
All use your agent key: `Authorization: Bearer tend_sk_…`.

**Rules for your integration**

1. **Act only on a 200 from consume** whose body repeats your request. Any other response, an error, a timeout or no
   response at all means *do not act*.
2. **Never retry consume.** If the response is lost, Tend may already have spent the authorization. Ask again.
3. Retrying step 1 is safe: send the same `Idempotency-Key` and you get the same request back.
4. **Build `detail` and `resource` from the values the action will actually use**, and pass the same strings to consume.
   The authorization is bound to the exact agent, tool, action, resource and detail. Any difference is refused.
5. The approval's answer comes from Tend. What the model, the agent or a log says about approval counts for nothing.
6. Step 5 is yours to send. A 200 from consume means *authorized once*; it is not evidence the action ran. Operators
   see execution only from your `tool.called` report.
7. Keep tokens and keys out of logs, prompts and error messages. Tokens are single-use secrets; Tend stores only a hash.

`examples/claude-agent/gate.mjs` implements all of this in about 120 lines with no dependencies:

```js
import { createGate } from "./gate.mjs";
const gate = createGate({ tend: tendHttp(process.env.TEND_URL, process.env.TEND_AGENT_KEY) });

const out = await gate.run(
  { tool: "send_payment", action: "execute", resource: invoice, detail: `EUR ${amount.toFixed(2)} to ${payee}` },
  async () => payments.send(invoice, amount, payee),   // runs at most once, only after Tend said yes
  (event) => tend("/api/v1/events", { type: "tool.called", data: event }),   // optional monitoring report
);
if (!out.executed) return `Not done (${out.outcome}).`;   // denied, rejected, expired, timeout, unavailable, refused
```

## Policy: what an agent may do

Each agent has a policy, a list of rules, set by an operator:

```
POST /api/v1/agents/{id}/policy      (operator session)
{ "enforcement": "enforce",
  "rules": [
    { "tool": "send_payment",  "action": "execute", "effect": "approve" },
    { "tool": "read_document", "action": "read", "resourcePrefix": "DOC-R-", "effect": "deny" },
    { "tool": "read_document", "action": "read", "effect": "allow" } ] }
```

- `effect`: `allow` (a token right away), `approve` (a person decides in the review queue), `deny`.
- A rule matches on `tool`, `action` (or `*`) and optionally a `resourcePrefix`. The most specific match wins; at equal
  specificity the stricter effect wins (`deny`, then `approve`, then `allow`). A prefix matches any resource that starts
  with it, so end prefixes at a delimiter (`INV-1:` rather than `INV-1`).
- An optional `permission` on a rule must be one the agent has been granted in Tend.
- **Spending always needs a person.** For the gateway tools that move money (`pay_invoice`), `allow` is never honoured:
  saving a policy with such a rule is refused (422 `spend_requires_approval`), and a policy saved earlier is evaluated as
  `approve`. Tend can only recognise the tools it knows; the tool names of your own agent are yours to govern.
- **No amount limits on gateway spend tools.** A gateway request carries the tool, action, resource and detail Tend derived,
  never raw arguments, so a `when` condition on a gateway spend tool (e.g. "approve when amount ≤ 500") can never read the
  amount and would silently never apply. Saving such a rule is **refused (422)** rather than giving a false sense of a cap;
  the amount is in the `detail` a person reads and confirms on every approval.
- **The permissions screen.** On a connected agent's page, operators choose per gateway tool: *Allow* (`allow`), *Ask me
  first* (`approve`) or *Never* (`deny`). It builds ordinary rules and saves them through the endpoint above; it
  shows what `GET /api/v1/agents/{id}/policy` reports (the decision the real evaluator would make per tool) and re-reads it
  after every save. Rules it cannot express (a prefix, a permission, a wildcard) appear as "Custom rules" and are left
  untouched. Saving also sets `enforcement` to `enforce`. A save made from an out-of-date view (`expectedVersion`) is
  refused with 409. A new agent has no rules, so everything starts as *Never*.
- **Default deny.** No matching rule, a policy that doesn't validate, a paused agent or a disabled integration all deny.
  A policy with any invalid rule is refused whole.
- Tokens last 60 seconds. A request nobody decides expires after 10 minutes; an approval nobody uses, after 5.
  Rejected, expired or cancelled requests never receive a token. Pausing the agent or tightening its policy also stops
  tokens already issued, including a change from `allow` to `approve` for authorizations no person approved.
- `enforcement` (`monitor` by default) never changes how authorization requests are evaluated (they always use the
  policy). It does two things:
  - It is sent to the agent as `config.enforcement` in `GET /api/v1/agent/inbox`. The example agent turns its gate on
    when it reads `enforce` (a caller can also force the gate on, but never off). If the inbox can't be read, the agent
    doesn't start.
  - In `enforce` mode Tend flags any reported execution (`tool.called` with outcome `success` or `failure`) of a tool
    the policy governs (some rule matches its tool, action and resource prefix) that carries no `authorizationId`:
    an **unauthorized execution** alert.

## Execution reports are checked against authorizations

A `tool.called` report with outcome `success` or `failure` that carries an `authorizationId` is checked against the
authorization record. Each finding is an alert marked **not blocked**, because the agent says the action already ran:

| Finding | Alert | `reason` |
|---|---|---|
| No such authorization for this agent (unknown id, or another agent's) | `authorization_mismatch` | `unknown_authorization` |
| The authorization was never consumed (reported before, or without, spending the token) | `authorization_mismatch` | `not_consumed` |
| Tool, action, resource or detail differ from what was authorized | `authorization_mismatch` | `execution_differs` |
| A second execution reported for the same authorization | `authorization_replay` | `executed_twice` |

At consume time, the same alert kinds are raised **blocked** (`replay`, `parameters_differ`, `invalid_token`). Tend
refused those, so nothing ran.

## The dashboard

Operators see every authorization under **Oversight → Authorizations**, filterable by status (waiting, approved, used,
rejected, denied by policy, expired, cancelled). A request waiting for a person shows exactly what the token will be
bound to (tool, action, resource and the full detail), the policy reason and when it expires. **Approve once** asks for
confirmation first; **Reject** is final. A pending or approved request whose deadline has passed is shown as expired at
once, and the server closes it on the next dashboard sync. Every step appears in the **Timeline** under
*Authorizations*. Approvals and rejections appear under *Human decisions*, and replay, mismatch and unauthorized-execution
alerts under *Alerts*. No token or token hash ever reaches the browser. Visitors on a public instance see the
authorizations of agents an operator marked public as their shape only (tool, action, status, timing), never the detail
text or the resource (see `docs/audit.md`).

## What Tend does to protect the flow

Tokens are 256 random bits, stored only as a hash, shown once, and spent by one atomic database update that checks the
token, its expiry and the bound request together. Concurrent or repeated attempts: at most one wins, and a repeat raises
a replay alert. A wrong token or changed parameters is refused without using up the approval, and three such attempts
revoke it. Another agent's authorizations look like they don't exist. Because a person approves `detail` by reading it,
it may not contain control, zero-width or bidirectional-override characters, which could make it display differently
from what is bound to the token. Such a request is refused (422).

## Known limits and bypass risks

- **The audit trail** (who approved, what policy applied, what can and cannot be altered) is described in [audit.md](audit.md).
- **Cooperative enforcement can be skipped** (see the top). Prefer a gateway or target-side check that holds the credentials.
- **Tend can't verify that `detail` and `resource` describe the real action.** It binds the approval to exactly what was
  asked; if your code describes one thing and does another, Tend can't tell. Derive them from the real parameters.
- **Resource names need canonical forms.** Identifiers are limited to letters, digits and `_ . : -` (64 characters).
  Aliases, case differences and path tricks in your own system are your concern; normalise before asking.
- **At-most-once authorization, not exactly-once execution.** If the agent crashes after consume, the action ran zero
  times and nothing says so until the missing `tool.called` report is noticed.
- **Policy can't express limits** such as "up to 500 EUR". Amounts are only in the free-text `detail` a person reads.
- **Humans can be fooled or tired.** An approval is only as good as the description shown.
- **The agent key is a bearer secret.** Anyone holding it can request authorizations (not approve them). Rotate it if
  exposed. An `allow` rule needs no human, so it is only as safe as the key.
- **Tend being down stops sensitive actions** (fail closed). There is no break-glass path.
- **Execution reports are cross-checked, but they are still the agent's own reports.** An agent that acts without
  asking and then stays silent (or reports an ungoverned tool name) is invisible to Tend. The cross-check catches
  inconsistent or careless integrations, not a deliberately lying one.
- **The example agent reads `enforcement` once, at start.** Switching an agent to `enforce` takes effect on its next
  run; Tend's policy still decides every request in the meantime.
- Operators are one shared role with no per-person approver identity or two-person rule.
- Expiry is applied when something next touches the data, not on a timer.
- The Lindenhof example agent uses simulated tools only. No real payment or customer system is involved anywhere in this repository. File operations in the notes demo go through the gateway into a temporary directory of fake notes; they never touch the operator's own files.
