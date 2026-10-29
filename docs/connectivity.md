# Connecting agents to TEND

TEND has one connection model for every agent: **the agent asks TEND before a sensitive action and acts only on TEND's yes.** Each provider
"adapter" is only the small piece of code that turns that provider's tool call into the same request. Everything behind it is shared and
unchanged: the agent's own key, the policies (including central ones), human approval, the audit log, revocation and fail-closed behaviour.

```
agent's tool call ──▶ adapter ──▶ TEND: ask ─▶ allow / ask a person / deny ─▶ one-time token ─▶ spend it ─▶ the tool runs once
  (Claude, OpenAI,      (maps the call to      (the same API and the same rules for every agent;          and the run is reported
   MCP host, HTTP)       tool, action,          every step is in the audit log)                            to the audit log
                         resource, detail)
```

## The adapter interface

An adapter needs exactly one thing: `connectTend()` from `examples/claude-quickstart/tend-client.mjs`, which returns `gate.run(request, run)`.

- `request` is `{ tool, action, resource?, detail? }`: what is about to happen, byte for byte. That is what a rule matches and what a person approves.
- `run()` does the real thing. It is called at most once, and only after TEND authorized exactly that request.
- The result is `{ executed, outcome, reason, detail }`. Anything but `executed: true` means nothing happened; tell the model so.
- Settings come from `TEND_URL` and `TEND_AGENT_KEY`. A missing key, a rejected key and an unreachable TEND each fail with a sentence, never a run.

| Connection | Code | Status (see the Integrations page for the evidence) |
|---|---|---|
| Claude, Anthropic SDK | `examples/claude-quickstart/agent.mjs`, `examples/real-agents/anthropic-agent.mjs` | Working: real model, 2026-10-29 |
| Any agent over HTTP | the three API calls, `docs/api-examples.md` | Working: run as written against a live TEND |
| OpenAI Agents SDK | `examples/real-agents/openai-agent.mjs` | Compatible, not yet verified: mocked provider API only |
| MCP (any MCP host and server) | `examples/mcp-proxy/tend-mcp-proxy.mjs` | Compatible, not yet verified: real MCP server process, scripted client, no real host |
| Hermes Agent, Google Gemini | none | Planned: nothing built or tested |

A new provider needs no change to TEND: map its tool call to `gate.run`, as the examples do.

## MCP

The proxy sits between an MCP host (the agent) and an MCP server (the tools). It passes every message through except `tools/call`, which is
forwarded only after TEND allows that tool, with action `call` and a `resource` that is a hash of **all** the arguments (so an approval covers
exactly those arguments, even when the readable `detail` is shortened). The server process never receives TEND's settings or key.
Configuration: see the comment at the top of `examples/mcp-proxy/tend-mcp-proxy.mjs`.

## What none of this can prevent

- **An agent that skips the adapter.** TEND controls only calls that ask it. An agent that also has the real credentials (an API key, a database
  password, a direct MCP server entry in its host configuration) can act without TEND, and TEND will not know. Give the credential to the gateway
  or the proxy's server process, never to the agent.
- **A host configured to start the MCP server directly**, or any other path to the same server.
- **Code on the same machine, as the same user**, which can read other processes' environment and files (see `docs/security-limitations.md`).
- **A misleading request.** TEND binds an approval to the request it was shown; if code describes one thing and does another, TEND cannot tell.

Enforcement fails closed: if TEND cannot be reached, answers with an error, or its database is unavailable, the action does not run
(`src/server/failure-modes.test.ts`, `examples/claude-agent/gate.test.mjs`, `src/server/mcp-proxy.test.ts`).
