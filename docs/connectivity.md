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

Statuses are not kept here: `npm run verify:integrations` runs the same real scenarios for every integration and writes them to
[verification-report.md](verification-report.md) (and `src/lib/verification-report.json`, which the Integrations page reads).

| Connection | Shared code |
|---|---|
| Anthropic SDK, OpenAI Agents SDK, LangChain, LangGraph, Mastra | `guardTool()` in `examples/adapters/guard.mjs` (or `gate.run()`) around each tool body |
| OpenAI, Gemini, Mistral, Groq, Ollama, any OpenAI-compatible server | `examples/adapters/openai-compatible.mjs`, with `guardTool()` around each tool |
| PydanticAI, AutoGen, CrewAI, any Python agent | `guard_tool()` in `examples/python/tend_gate.py` (standard library only) |
| Claude Code, Cursor, Cline, Hermes Agent, OpenClaw, any MCP host | `examples/mcp-proxy/tend-mcp-proxy.mjs` in front of the MCP server |
| Any language | the HTTP API, `docs/api-examples.md` |
| Aider | none: no MCP and no tool-call hook, so there is nothing to intercept |

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

## One policy for every framework

Every adapter asks TEND in the same form: the tool name, the action `call`, a hash of all arguments as the resource, and the readable arguments
as the detail. So one central policy (`npm run tend -- policy create ...`, or the API) governs agents on any framework at once; an agent's own
rules can only make it stricter. `npm run demo:universal` shows it with real models: one policy, four frameworks (Anthropic SDK, LangChain,
PydanticAI, Claude Code through MCP), one change applied to all, one agent revoked without touching the others, one audit log.

Developers get the adapters from their TEND server: `curl -fsSO $TEND_URL/sdk/tend.mjs` (JavaScript, including the MCP proxy:
`node tend.mjs -- <server command>`) or `/sdk/tend_gate.py` (Python). Built from `examples/` by `scripts/build-sdk.mjs`.

## Trying a policy before saving it

**Preview against recorded actions** (Policies, while editing) replays the agent's requests of the last 30 days through the draft and shows
what would be allowed, held for a person or blocked, and which decisions would change. For a central policy:
`npm run tend -- simulate "<policy>" --rule tool:action:effect ...`, or `POST /api/v1/policy-simulations`. It reads only (through the
read-only wrapper the protection checks use) and never runs a tool.

## Measuring it

`npm run benchmark` (setup steps, added latency, load, enforcement, reliability; results in `docs/benchmark.md`) and `npm run reliability`
(each failure case and the tests that show protected actions fail closed in it).

