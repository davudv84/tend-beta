# TEND benchmark

Measured by `npm run benchmark` (scripts/benchmark.mjs) on 2026-10-29: Apple M1 Pro, 10 cores, 16 GB, darwin 27.0.0,
Node v24.16.0, an isolated production build with the embedded database over loopback. Rerun it to reproduce; numbers
on another machine, or against a hosted TEND (network round trips, a hosted database), will differ. No competitor was measured.

## Setup and integration steps

| | Measured |
|---|---|
| From nothing to an enforced tool call (allowed, denied, approved), scripted | 360 ms, enforced correctly: true |
| A person in the browser, sign-in to verified test action (measured once, 2026-10-29) | 89 s |
| Steps for a developer | 6: create the agent (name, model) and copy its key; set three rules; download one file (curl); set TEND_URL and TEND_AGENT_KEY; wrap each tool with guardTool; approve the held call |
| Lines of integration code | Anthropic SDK 3, LangChain 4, OpenAI Agents SDK 7, OpenAI-compatible 4, Python 6; an MCP host: configuration only (one JSON entry) |
| Dependencies the agent must install | 0 (one 28 KB file from the TEND server) |

## Added latency (milliseconds, p50 / p95 / p99)

| Call | Latency |
|---|---|
| A no-op tool, called directly | 0 / 0 / 0.01 |
| The same tool through TEND, until it starts running | 4.42 / 5.73 / 15.22 |
| The same call including the audit report afterwards | 8.26 / 10.57 / 24.74 |
| MCP tools/call to a stdio server, directly | 0.02 / 0.09 / 0.27 |
| MCP tools/call through TEND's proxy | 7.49 / 8.86 / 11.73 |

300 calls each (100 for MCP), allowed by policy, sequential. allowed by policy: request, single-use token, consume, then the tool; the audit report follows the tool. Loopback and an embedded database: a hosted TEND adds the network round trips.

## Limits

One protected call makes 2 authenticated requests (counted on the wire). Each agent may make 120 a minute by default,
so about **60 protected calls per agent per minute**; past that, calls are refused (never let through). Raise it with
TEND_AGENT_RPM (10–10000); this benchmark runs with it raised so the latency and load figures are not cut off by it.

## Under load

10 agents at once, 30 allowed calls each: 1.93 s, 155 calls per second, 0 errors.
Database writes per protected call: 1 authorization row and 3 events (hash-chained). Server memory (RSS):
482 MB before the load, 520 MB after.

## When TEND is down

A protected call is refused, never run, 1009 ms after it starts with the default retries (1 ms with retries: 0).
Calls that ran while TEND was unreachable: **0**.

## Enforcement

60 mixed requests (allowed, denied, approved, rejected): expected 30 to run and 30 never to run;
observed {"allow":15,"deny":0,"approved":15,"rejected":0}. Violations: **0**.

Real models: 13 integrations pass all 7 scenarios (allow, deny, approve, reject, revoke,
TEND unavailable, audit); 8 are blocked on credentials or installs (src/lib/verification-report.json (npm run verify:integrations)).

## Reliability

| Case | Result |
|---|---|
| Unauthorized tool execution | fails closed (6/6 tests) |
| Agent revocation | fails closed (5/5 tests) |
| Approval replay | fails closed (4/4 tests) |
| Policy change during a pending approval | fails closed (4/4 tests) |
| TEND unavailable | fails closed (3/3 tests) |
| Database unavailable | fails closed (3/3 tests) |
| Cross-tenant isolation | fails closed (6/6 tests) |

The cases and the tests behind them: scripts/reliability.mjs.

## Comparing with an alternative

Run the same five measurements against it, on the same machine: the steps and lines of code to put it in front of one tool; the time from
nothing to a denied and an approved call; a no-op tool's latency directly and through it (p50/p95/p99, 300 sequential calls); calls per
second with 10 concurrent agents; and whether denied or rejected calls ever run when the control service, its database, or the
network fails. Numbers for other products are not given here because none were measured.
