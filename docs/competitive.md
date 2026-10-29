# TEND and the alternatives

Checked 2026-10-29 against each product's own documentation (links inline). Capabilities only; no performance comparison, because none was
measured. "Not found" means the public docs did not show it, not that it cannot be built.

| | Pre-execution tool policy | Human approval per call | Audit | Frameworks / MCP | Argument-level rules | Model |
|---|---|---|---|---|---|---|
| **TEND** | allow / deny / approve, central + per agent | yes, bound to the exact arguments, single use | append-only, hash-chained | 13 integrations verified with real models; MCP proxy | `when` conditions (domains, paths, numbers, lists) | open source, self-hosted |
| [Portkey MCP Gateway](https://portkey.ai/docs/product/mcp-gateway/guardrails.md) | guardrails on `tools/call` before execution; tool provisioning per workspace | mentioned in the overview, not documented in detail | every tool call logged | MCP proxy + LLM gateway | guardrail checks on inputs | [MIT core](https://github.com/Portkey-AI/gateway); paid tiers |
| [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/human_in_the_loop/) | tool guardrails (not for hosted tools or handoffs) | `needs_approval` (bool or callable over the arguments); hosted MCP `require_approval` | tracing to the OpenAI dashboard, not an audit log | OpenAI SDK only | yes, in your callable | free SDK |
| [Claude Agent SDK / Claude Code](https://code.claude.com/docs/en/agent-sdk/permissions) | permission rules, modes, PreToolUse hooks, `canUseTool` | `ask` rules, hooks | what your hooks write | Claude only (MCP tools included) | patterns like `Bash(rm *)` | free SDK; managed settings for organisations |
| [Microsoft Agent Governance Toolkit](https://github.com/microsoft/agent-governance-toolkit) | deterministic check before every call; YAML, OPA or Cedar | `require_approval` with named approvers | tamper-evident (Merkle) | many frameworks + MCP gateway, Claude Code | not clearly documented | MIT, public preview |
| [Permit.io MCP Gateway](https://docs.permit.io/permit-mcp-gateway/) | RBAC/ABAC/ReBAC per call, deny by default | high-risk calls, Enterprise plan | per decision | MCP proxy | not described | hosted SaaS |
| [Auth0 for AI Agents](https://auth0.com/ai/docs/intro/asynchronous-authorization) | not a policy engine | CIBA push/email with the exact transaction (RAR) | not the focus | samples for several frameworks | through RAR details | paid add-on |
| [Arcade.dev](https://docs.arcade.dev/en/guides/contextual-access) | access, pre- and post-execution hooks (your webhook) | not documented | via your hooks | many frameworks | via your hooks | brokers OAuth tokens: agents never hold them |
| [Invariant Guardrails](https://github.com/invariantlabs-ai/invariant) | rule language over calls, including sequences | not the focus | trace analysis | MCP/LLM proxy | regex over arguments | Apache-2.0 (current maintenance unclear) |

## What is not a differentiator any more

Allow/deny/approve before a tool runs, approvals that show the arguments, an MCP proxy, per-agent revocation and one policy across frameworks all
exist elsewhere. The Microsoft Agent Governance Toolkit covers nearly the same framework list and has tamper-evident logs.

## What TEND does that the others do not appear to

- **An approval is a single-use authorization bound to the exact request**, arguments included, spent atomically: a replay, a changed argument or
  a second delivery of the same call is refused. OpenAI's docs say their approval state is not authenticated; Auth0's RAR comes closest but has no
  policy engine around it. (Medium-high confidence.)
- **Policy simulation against recorded actions** before saving a change. Not found in any product above (Agent Governance Toolkit has a linter).
- **All of it in one small, free, self-hosted product**, verified end to end with real models per integration (`docs/verification-report.md`).

## Where TEND is weaker

- **Cooperative enforcement.** Proxies (Portkey, Permit, Invariant) and credential brokering (Arcade) control calls the agent cannot skip; TEND's
  SDK path does not. (Its MCP proxy is a proxy, but only for hosts configured to use it.)
- **Policy language.** No ABAC/ReBAC, no OPA/Cedar, no rules over sequences of calls.
- **No threat detection** (content guardrails, prompt-injection or tool-poisoning scanning).
- **No enterprise identity**: SSO, roles, approvals through an identity provider or push.
- **Maturity**: one developer, no independent security review, no production deployment yet.

## What would create the most advantage

1. **Make TEND's decision checkable by the tool**: a signed, short-lived receipt over the tool and the hash of its arguments, and a small verify
   helper for tool servers (and TEND's own MCP proxy) that refuses calls without one; then broker credentials so agents never hold them. This
   moves protected tools from cooperative to enforced, which none of the SDK-based alternatives offer.
2. **Make simulation the centre of policy changes**: replay recorded actions on every change, show the difference, and run it in CI.
3. **Approvals where people are** (Slack, push) showing the exact arguments, and **rules over sequences** (e.g. no outbound email after reading
   private data in the same session).
