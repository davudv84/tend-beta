# Guided setup: connect an agent and verify one real action

`/connect` in the dashboard walks an operator through four steps. Everything it shows comes from what Tend has really
recorded; nothing is simulated.

| Step | What the person does | What is real |
|---|---|---|
| 1. Create | Names the agent | `POST /api/v1/agents`: a connected agent and its key (shown once, kept only in the page's memory) |
| 2. Permissions | Chooses Allow / Ask me first / Never per tool | The existing policy API and the permissions screen. Everything starts blocked. For the test, "Send a test ping" is pre-selected as *Ask me first*; nothing is saved until the person saves |
| 3. Connect and test | Pastes one command where the agent runs, then approves or rejects in the dashboard | The script calls `agent/inbox`, `gateway/requests`, `authorizations/{id}/token` and `gateway/execute`, the endpoints every agent uses. "Connected" turns on only when a call carrying the agent's key reaches Tend (`last_seen_at`) |
| 4. Result | Reads the outcome | Facts from Tend's records: the authorization (status `consumed`, single use), the person's decision, and the gateway's own `tool.called` event for that authorization |

The result screen reports **verified** only when the authorization is `consumed` **and** the gateway recorded a successful
`tool.called` for that same authorization id. An agent's own report is not accepted as proof. Rejected, blocked
(denied by default), expired or failed outcomes each have their own screen and nothing runs in them.

## The test action

`test_ping` is a built-in gateway tool that does nothing real: it echoes a short message (1–40 letters, digits and
spaces). It goes through exactly the same authorization as every other tool (policy, human approval, single-use token,
parameters bound to the approval) and is blocked until a rule allows it. Tool output is not stored in events, so the
reply appears only in the agent's own terminal.

## What works on its own, and what needs manual setup

Works out of the box on any Tend server that has `TEND_ADMIN_TOKEN` set:

- creating an agent, choosing permissions, running the test, approving or rejecting, and the result screen;
- the `test_ping` tool (no credential involved).

Needs manual setup, and is **not** done by this flow:

- **Signing in.** There are no accounts. An operator signs in with the server's `TEND_ADMIN_TOKEN`.
- **Real tools.** `list_notes`, `read_note`, `write_note` need `TEND_GATEWAY_NOTES_DIR` on the server; `pay_invoice`
  (a fake payments API) needs `TEND_GATEWAY_PAYMENTS_KEY`. The permissions screen marks a tool "not set up" when the
  server lacks it. Adding a tool for your own system means adding it to the gateway ([gateway.md](gateway.md)).
- **Your actual agent.** The pasted script proves the path; it is not your agent. To use gateway tools from your own
  agent, call the same four endpoints (see `examples/claude-agent/gateway-client.mjs`). "Copy script only" is a starting point.
- **Running the command.** It needs Node 18 or newer and a Unix-style shell on the machine where the agent runs. If that
  is not the machine you browse from, replace the address in the command with this server's public address.
- **Separation.** The command is only meaningful if the agent really does not hold the credentials for what it asks to
  do. Tend cannot check that ([gateway.md](gateway.md), [audit.md](audit.md)).
- **HTTPS** for anything beyond local use, and a database user that cannot alter the schema.

## Known limits

- The pasted command embeds the page's own address (`window.location.origin`). If the agent runs on another machine, the
  person must replace it; the page says so.
- The key is held only in the page's memory. Leaving the page loses it; `/connect?agent=<id>` resumes and offers a new key
  (which ends the old one).
- A new request only counts if it arrives after the person pressed Continue, so an old result is not mistaken for a new one.
- The result screen shows what Tend recorded (who decided, when the gateway ran it, the outcome). It does not show the
  tool's reply, because Tend never stores tool output.
- It does not make the agent safe by itself: see the separation note above.

## Verification

- `src/server/connect.test.ts` runs the exact script as a separate process against Tend's real handlers over HTTP: approved
  (runs once), rejected (nothing runs), no permission (denied by default), wrong key (no connection recorded). It checks the
  key and token are never printed.
- `src/lib/onboarding.test.ts`: the screen's state logic, including that only the gateway's own record proves success.
- `npm run e2e:connect` (needs `npm run build`): the same flow against a real server on a temp database, driven through the
  operator API.
- By hand in a browser against an isolated server (temp database, fake admin token): create, permissions (saved through the
  panel, server state checked), connect (copy buttons checked, the real command run in a terminal), approve, reject, blocked
  and resume paths, English and German.
