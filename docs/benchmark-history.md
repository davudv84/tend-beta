# Benchmark: before and after the one-round-trip flow

Both runs: `npm run benchmark`, same machine (Apple M1 Pro, Node v24.16.0), isolated production build, embedded database, loopback.
Before: 2026-10-29 21:51 UTC (authorize → token → consume → report). After: 2026-10-29 22:50 UTC (authorize-and-spend → report; after an approval: authorize → spend → report).
The security checks are the same in both: every reliability case and the enforcement run pass. A hosted TEND adds a network round trip per request, so halving the requests matters more there than here.

| Measure | Before | After |
|---|---|---|
| Authenticated requests per protected call | 4 | 2 |
| Protected calls per agent per minute (default limit) | 30 | 60 |
| Until the tool runs, ms p50 / p95 / p99 | 12.3 / 26.84 / 55.87 | 4.42 / 5.73 / 15.22 |
| Whole call incl. audit report, ms p50 / p95 / p99 | 16.66 / 47.73 / 65.63 | 8.26 / 10.57 / 24.74 |
| MCP tools/call through TEND, ms p50 / p95 / p99 | 15.99 / 18.33 / 22.33 | 7.49 / 8.86 / 11.73 |
| 10 concurrent agents, protected calls per second | 74 | 155 |
| Errors under load | 0 | 0 |
| Enforcement violations (60 mixed requests) | 0 | 0 |
| Reliability cases failing closed | 7/7 | 7/7 |

Also measured after (no earlier figure): 3 events and 1 authorization row written per protected call; server memory 482 → 520 MB across the load run; with TEND unreachable a call is refused after 1009 ms (default retries) and none ran.
