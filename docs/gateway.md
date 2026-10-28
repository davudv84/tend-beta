# Secure execution gateway

The cooperative flow in [enforcement.md](enforcement.md) depends on the agent asking first, and an agent that holds the
real credential can skip the question. The gateway moves the credential into Tend. The agent asks Tend to *run* a
tool, and Tend runs it only after a single-use authorization for exactly that call has been consumed.

## Flow

```
1. POST /api/v1/gateway/requests        { tool, params }                         agent key
      → the gateway validates params against the tool's schema and derives { tool, action, resource, detail } from them
      → the existing authorization flow: 201 approved | 201 pending (a person decides) | 403 denied
2. POST /api/v1/authorizations/{id}/token                                         agent key
      → 202 pending … 200 { token } (single use, 60 s)
3. POST /api/v1/gateway/execute         { authorizationId, token, tool, params }  agent key
      → params validated and described again; consumeAuthorization() checks the token, expiry, agent, status,
        current policy and the fingerprint of the derived description in one atomic UPDATE
      → only then: the tool runs with the gateway's credential, with a timeout and bounded retries
      → 200 { executed: true, result: <allowlisted fields> } | 4xx refused, nothing ran | 502 outcome unknown
```

Every refusal and every execution is a `tool.called` event (actor `system`, `via: gateway`) carrying the bound fields,
the outcome and an error code. The existing authorization events (`authorization.requested`, `.consumed`, …) and alerts
(`authorization_replay`, `authorization_mismatch`) still apply. The dashboard shows them as before.

## The example tool: `pay_invoice`

A fake payments API (`fakePaymentsApi` in `src/server/gateway.ts`). It moves no money and talks to no network.

| Param | Schema |
|---|---|
| `invoice` | `INV-` followed by 1–10 digits. This is the bound `resource`. |
| `amountCents` | integer, 1–100000 |
| `currency` | `EUR` or `USD` |
| `payee` | a key of the server-side payee directory (`PAYEE-1`, `PAYEE-2`). Never an account number or URL. |

Bound `detail`: `EUR 12.34 to Fake Supplier GmbH (PAYEE-1)`. Every param appears in `resource` or `detail` without
rounding, so two different payments can never share an approval. The credential is `TEND_GATEWAY_PAYMENTS_KEY`, at least
24 characters. Without it the tool answers 503 `tool_unavailable` **before** consuming, so the approval isn't spent.
For demonstrating failure handling, invoice `INV-503` fails transiently once (retried, pays once) and `INV-504` never
answers (it times out after 3 s and is not retried).

Policy example: `{ "tool": "pay_invoice", "action": "execute", "effect": "approve" }`. Every gateway tool needs an
authorization. An `allow` rule only skips the human; the token is still single use and bound.

## Notes tools: `list_notes`, `read_note`, `write_note`

All three operate on `TEND_GATEWAY_NOTES_DIR` (an absolute path; unset means they answer 503). The directory plays the
credential's part: the agent never learns it and cannot pass a path. `name` is 1–32 of `a-z 0-9 -`.

| Tool | Action | Params | Bound resource / detail | Output |
|---|---|---|---|---|
| `list_notes` | `list` | `{}` | `notes` / `list files` | `names` (comma-separated), `count` |
| `read_note` | `read` | `{ name }` | `<name>.txt` / `read <name>.txt` | `file`, `text`, `bytes` |
| `write_note` | `create` | `{ name, text }` | `<name>.txt` / the exact `text` (1–160 printable ASCII) | `file`, `bytes` |

`write_note` creates with `wx`: never overwritten, never through a symlink. `read_note` and `list_notes` skip
symlinks and ignore names outside the alphabet. Policy example: `{ "tool": "write_note", "action": "create", "effect": "approve" }`.

An interactive isolated demo (temp database, temp notes directory, fake notes only) is `npm run demo:claude-notes`.
Approvals are decided in **Oversight → Authorizations**, not by the script. Pass `--scripted` to play back tool calls
without calling Anthropic.

## Sandbox tools: `read_test_file`, `write_test_file`, `delete_test_file`

Disposable-file tools for trying real OpenAI and Anthropic agents safely, on `TEND_GATEWAY_SANDBOX_DIR`. Params take one plain file
name, never a path. Limits: see the section on bypass paths below.

## The connection test: `test_ping`

A built-in tool that does nothing real, used by the guided setup ([connect.md](connect.md)) to prove the whole path.
Action `ping`, params `{ message }` (1–40 letters, digits and spaces), bound resource `test`, bound detail `Say: <message>`,
output `{ reply }`. It needs no credential, is always available, and is blocked until a rule allows it like every other tool.
Policy example: `{ "tool": "test_ping", "action": "ping", "effect": "approve" }`.

## Trust boundary of the notes agent

| Who | Holds | Can do |
|---|---|---|
| Tend server | `TEND_GATEWAY_NOTES_DIR`, database, `TEND_ADMIN_TOKEN` | Runs the file operation, only after one atomic consume of a bound authorization. |
| Notes agent process | Its `tend_sk_` key, `TEND_URL`, `ANTHROPIC_API_KEY` | Asks, waits, spends a token at `/gateway/execute`. Has no `fs` import and no path. |
| Operator | Admin token / session cookie | Approves or rejects. |

`examples/claude-agent/isolation.mjs` makes the agent side refuse to run (fail closed) when:

- its own environment holds any `TEND_GATEWAY_*`, `TEND_ADMIN_TOKEN`, `TEND_DATA_DIR`, `DATABASE_URL` or `POSTGRES_URL`
  (a gateway credential would let it skip the gateway; the admin token would let it approve its own requests). Only
  variable names are reported. The CLI and the demo always run this check; `runNotesAgent({ env })` runs it when given `env`.
- Tend does not report the agent as `enforce` (`/api/v1/agent/inbox`). Server-side the gateway is enforced in every
  mode; `enforce` additionally makes Tend alert on any execution the agent reports without an authorization.

Regression tests: `examples/claude-agent/notes-enforcement.test.mjs`.

### Bypass paths that remain outside Tend's control

Do not read the above as universal enforcement.

- **Shared host or volume.** If the agent process can read or write the notes directory by any route (same user, a
  mount, a container sharing the volume), it can skip Tend. The environment check sees variables, not file permissions.
  Run the agent as a different user or container with no access to that path.
- **Library callers.** `runNotesAgent` called without `env` skips the credential check, and a different agent
  that is not built on `gateway-client.mjs` is not covered at all.
- **Policy `allow`.** An `allow` rule skips the human for that tool; the token is still single use and bound.
- **The agent key is a bearer secret.** Anyone holding it can request, and under `allow` execute, gateway tools.
- **Approver error, and one shared operator login.** A fooled approver approves what they read; approvals carry no
  per-person identity yet.
- **At most once, not exactly once.** After a timeout the outcome is unknown and the authorization is spent.

## Security properties, and where they are enforced

| Property | Mechanism |
|---|---|
| Tool allowlist | `TOOLS` in `gateway.ts`; lookup with `Object.hasOwn` (no prototype keys). Unknown tool → 404. |
| Strict params | Exact keys, exact types, no coercion. Unknown fields → 422. No param is a URL, command, path or code. |
| Agent identity | The agent key (`authAgent`). Authorizations are scoped to the agent; another agent's id → 404. |
| Exact binding | The gateway derives `resource` and `detail` from the params at both request and execute. The fingerprint covers agent, tool, action, resource and detail. Any difference → 403 `mismatch`; three attempts revoke the approval. |
| Short-lived, single use | 60 s token; consumption is one conditional `UPDATE`. Of N concurrent executes, exactly one runs (tested with 6). Replay → 409 and a replay alert. |
| Expired, revoked, cancelled, paused | `consumeAuthorization` re-checks status, expiry and the *current* policy and agent state. |
| Fail closed | Any refusal, DB error or missing credential happens before the tool runs. Only a successful consume reaches `invoke()`. |
| Timeouts and retries | 3 s per attempt. Up to 2 attempts, only for errors the tool marks transient, and always with the authorization id as the upstream idempotency key. Timeouts are never retried. |
| Credential isolation | Read from the environment at execution time and passed only to the tool function. Not stored, not in events, not logged. Output passes a per-tool allowlist (`paymentId`, `status`). The fake API deliberately echoes the key, and the tests show it is stripped. |
| Safe errors | Tool errors become `timeout` or `tool_error`. Upstream messages never reach the agent, the log or the console. |
| Limits | 4 KB request bodies (413). 30 gateway calls per agent per minute (429), on top of the 120/min agent limit. |

## Trust boundaries

```
 agent process  ── agent key (tend_sk_) ──▶  Tend server  ── gateway credential ──▶  tool / upstream
 (untrusted)                                 (trusted)                               (trusted to honour idempotency keys)
                                                 ▲
 operator browser ── session cookie ─────────────┘   approves; never sees tokens, hashes or credentials
```

- **Agent ↔ Tend:** the agent is untrusted. It can ask for anything; it can only run allowlisted tools with
  schema-valid params that a policy (and, for `approve`, a person) authorized.
- **Tend ↔ tool:** the credential crosses only this boundary. Anyone who can read the Tend server's environment, or
  run code in its process, holds the credential.
- **Operator ↔ Tend:** a single shared operator role (see enforcement.md). An operator can approve anything.

## What this does not prevent

Read this before relying on it.

- **The gateway only protects credentials the agent does not have.** If the agent's environment, files or network can
  still reach the real API key, or the target system directly, the agent can bypass Tend completely. The gateway is a
  boundary only once the credential has been **removed from everywhere the agent can reach** and the target accepts
  it only from the gateway (network policy, IP allowlist, separate key). Tend can't verify any of this.
- **The agent key is a bearer secret.** Whoever holds it can request and, under an `allow` rule, execute gateway
  tools. Under `approve`, they still need a person.
- **A person approves what the description says.** The description is now derived from the real parameters, which
  closes the cooperative flow's "describe one thing, do another" gap for gateway tools. A careless or fooled approver
  is still a risk.
- **At most once, not exactly once.** A 502 `timeout` means the outcome is unknown: the tool may have acted. The
  authorization is spent, and trying again needs a new one. A crash between consume and execution means zero
  executions. The `authorization.consumed` event without a matching gateway `tool.called` shows it.
- **Retries rely on the upstream honouring idempotency keys.** The fake does. A real integration must verify its API does.
- **The fake tool's ledger is in memory.** It shows idempotency within one server process, not across instances.
- **`/api/v1/authorizations/{id}/consume` still accepts gateway-tool authorizations.** An agent can burn its own
  approval that way, but it gains nothing without the credential.
- **Rate limits are a fixed one-minute window** in the database. They slow abuse; they don't stop a distributed one.
- **Not independently reviewed.** Treat this as a working local implementation, not production-ready, until it has had
  an external security review.

## Adding a tool

Add an entry to `TOOLS` with a strict `parse`, an injective `describe`, a `credential()` read from the server
environment, `run`, an `output` allowlist, `timeoutMs` and `maxAttempts`. Never accept URLs, hostnames, file paths,
shell fragments or code as params. Map identifiers to destinations server-side, as `PAYEES` does.

## Tests

- `src/server/gateway.test.ts`: in-memory database, 11 tests (unauthorized, exact once, concurrency, mismatch, expiry,
  identity, cancel and pause, schema, missing credential, retry, timeout, no credential in results or events).
- `src/server/postgres.test.ts`: the same guarantees on real PostgreSQL with overlapping requests, including one tool run
  for five identical executions. `npm run test:postgres` (see [audit.md](audit.md)).
- `scripts/gateway-e2e.mjs`: real HTTP against an isolated server with a temp database and random fake secrets.
  `npm run build && npm run e2e:gateway`, about 75 s.
- `scripts/claude-notes-e2e.mjs` (`npm run build && npm run e2e:claude-notes`): the shipped notes agent with a real Claude model,
  run as its own process with a five-variable environment, against an isolated server (temp database, seeded temp notes
  folder, throwaway admin token, none of your configuration). Scenarios: approval (the approved text is exactly what gets
  written, once), rejection (nothing is written), and no-permission (denied by default, nothing written), plus probes made
  with the agent's key (forged token, unknown tool, path and URL smuggling, another agent's approval) and a leak scan.
  The script plays the operator through the real operator API; the agent never sees the notes path. Needs
  `ANTHROPIC_API_KEY`; about $0.015 per run; capped at `MAX_USD` (default 0.50). It reports INCONCLUSIVE, not a pass, if
  the model never attempts a write. The agent is separated from the folder by knowledge, not by file permissions.
- `scripts/claude-gateway-e2e.mjs`: a real `claude-haiku-4-5` tool call through `write_note` on an isolated server
  (unauthorized, pending, approved, replay, modified params, no leaks). Needs `ANTHROPIC_API_KEY`; capped at
  `MAX_USD` (default 0.50), costs well under a cent. `npm run build && npm run e2e:claude-gateway`.
