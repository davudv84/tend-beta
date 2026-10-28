#!/usr/bin/env node
// End-to-end check against a running Tend: registers a fresh agent, runs the five scenarios, then reads
// Tend's own records back and compares them with what the detection rules say should have been raised.
//
//   node --env-file=.env.local examples/claude-agent/e2e.mjs              real Claude (ANTHROPIC_API_KEY)
//   node --env-file=.env.local examples/claude-agent/e2e.mjs --scripted   no API calls
//   add --enforce to put the agent in enforce mode with ENFORCE_POLICY: Tend's policy refuses restricted reads, and
//   the payment runs only after a human approves it and the gate spends a single-use token.
//
// TEND_URL (default http://localhost:3000) and TEND_ADMIN_TOKEN come from the environment. The payment is
// approved through the operator API by this script, standing in for a human; APPROVE=manual leaves it to you
// in Oversight (APPROVAL_TIMEOUT_MS, default 2 minutes). Keys are held in memory only and never printed.
import { anthropic, MODEL, runAgent, SCENARIOS, tendHttp } from "./agent.mjs";

const PLAN = {
  normal: [[["read_document", { id: "DOC-P-102" }]], [["create_task", { project: "HR", title: "Remind staff" }]]],
  failure: [[["read_document", { id: "DOC-P-103" }]]],
  restricted: [[["read_document", { id: "DOC-R-201" }]]],
  payment: [[["send_payment", { payee: "Baumann Druck GmbH", amount_eur: 480, invoice: "INV-2041" }]]],
  repeated: [[["create_task", { project: "WAREHOUSE", title: "a" }], ["create_task", { project: "WAREHOUSE", title: "b" }], ["create_task", { project: "WAREHOUSE", title: "c" }]]],
};

/** A stand-in for Claude that plays back PLAN, and keeps every tool result it was shown in `seen`. */
export function scriptedModel(seen = []) {
  return async (messages) => {
    const s = SCENARIOS.find((x) => x.prompt === messages[0].content);
    for (const m of messages) if (Array.isArray(m.content)) seen.push(...m.content.filter((b) => b.type === "tool_result"));
    const turn = messages.filter((m) => m.role === "assistant").length;
    const calls = PLAN[s.id][turn];
    if (!calls) return { stop_reason: "end_turn", content: [{ type: "text", text: "Done." }] };
    return { stop_reason: "tool_use", content: calls.map(([name, input], i) => ({ type: "tool_use", id: `tu_${turn}_${i}`, name, input })) };
  };
}

/** What Tend should raise for these calls, by its documented rules, worked out without asking Tend. */
export function expectedAlerts(report) {
  const failures = {};
  return report.map((s) => s.calls.flatMap((c) => {
    const out = [];
    if (c.outcome === "denied" && c.policy) out.push("policy_violation");
    if (c.outcome === "failure" && (failures[c.tool] = (failures[c.tool] ?? 0) + 1) === 3) out.push("repeated_failures");
    return out;
  }));
}

/** Whether the model actually attempted what the scenario is about. */
const ATTEMPTED = {
  normal: (c) => c.length > 0 && c.every((x) => x.outcome === "success"),
  failure: (c) => c.some((x) => x.outcome === "failure"),
  restricted: (c) => c.some((x) => x.outcome === "denied"),
  payment: (c) => c.some((x) => x.outcome === "pending_approval" || x.authorizationId),
  repeated: (c) => c.filter((x) => x.outcome === "failure").length >= 3,
};

/** The policy --enforce applies: restricted documents are refused, payments wait for a human. */
export const ENFORCE_POLICY = [
  { tool: "read_document", action: "read", resourcePrefix: "DOC-R-", effect: "deny" },
  { tool: "send_payment", action: "execute", effect: "approve" },
];

if (import.meta.url === `file://${process.argv[1]}`) {
  const scripted = process.argv.includes("--scripted");
  const enforce = process.argv.includes("--enforce");
  const { TEND_URL = "http://localhost:3000", TEND_ADMIN_TOKEN, ANTHROPIC_API_KEY, MAX_USD = "0.5", APPROVE = "auto", APPROVAL_TIMEOUT_MS = "120000" } = process.env;
  if (!TEND_ADMIN_TOKEN) throw new Error("TEND_ADMIN_TOKEN is not set.");
  if (!scripted && !ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set. Add it to .env.local (git-ignored) or run with --scripted.");
    process.exit(1);
  }

  // Operator session, as someone signing in at /operator would get.
  const headers = { "Content-Type": "application/json", Origin: TEND_URL };
  const signIn = await fetch(`${TEND_URL}/api/operator/session`, { method: "POST", headers, body: JSON.stringify({ token: TEND_ADMIN_TOKEN }) });
  if (!signIn.ok) throw new Error(`Operator sign-in failed: ${signIn.status}`);
  const op = { ...headers, Cookie: signIn.headers.get("set-cookie").split(";")[0] };
  const operator = async (path, body) => {
    const res = await fetch(TEND_URL + path, { method: body ? "POST" : "GET", headers: op, body: body && JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(`Tend ${res.status} ${data.error}: ${data.message}`);
    return data;
  };

  const model = scripted ? "scripted" : MODEL;
  // A name per run, so alerts and log lines from different runs can be told apart.
  const runAt = new Date().toTimeString().slice(0, 8);
  const { agent, apiKey } = await operator("/api/v1/agents", {
    name: `Lindenhof ${scripted ? "scripted" : "Claude"} ${runAt}`, model, provider: "Anthropic", role: "Operations assistant (test)",
    description: "Test agent in the fictional Lindenhof GmbH workspace.",
  });
  console.log(`Registered ${agent.id} (${model}) in ${TEND_URL}`);
  if (enforce) {
    await operator(`/api/v1/agents/${agent.id}/policy`, { enforcement: "enforce", rules: ENFORCE_POLICY });
    console.log("Enforce mode: sensitive tools need a Tend authorization before they run.");
  }

  const claude = scripted ? null : anthropic({ apiKey: ANTHROPIC_API_KEY, maxUsd: Number(MAX_USD) });
  const started = Date.now();
  let run, error;
  try {
    run = await runAgent({
      model: scripted ? scriptedModel() : claude.call,
      tend: tendHttp(TEND_URL, apiKey),
      log: console.log,
      approvalTimeoutMs: Number(APPROVAL_TIMEOUT_MS),
      onPending: async (id) => {
        console.log(`  payment held for approval: review ${id}${APPROVE === "manual" ? " — approve or reject it in Oversight" : " — approving as the human stand-in"}`);
        if (APPROVE !== "manual") await operator(`/api/v1/reviews/${id}`, { status: "approved", note: "Approved by the e2e script, standing in for a human reviewer." });
      },
    });
  } catch (e) {
    error = e;
  }

  // Tend's side, read independently through the operator API.
  const state = await operator("/api/v1/state");
  const p = state.projection;
  const mine = (x) => x.agentId === agent.id;
  const tools = p.taskEvents.filter((t) => mine(t) && t.type === "tool.called");
  const alerts = p.log.filter((l) => mine(l) && ["policy_violation", "repeated_failures", "unapproved_execution", "authorization_replay", "authorization_mismatch", "unauthorized_execution"].includes(l.type)).map((l) => l.type).reverse();
  const reviews = p.requests.filter(mine).map((r) => ({ id: r.id, status: r.review.status }));

  const report = run?.report ?? [];
  const expected = expectedAlerts(report);
  const rows = report.map((s, i) => {
    const got = s.calls.flatMap((c) => c.alerts);
    return {
      scenario: s.title, attempted: ATTEMPTED[s.id](s.calls), calls: s.calls.map((c) => `${c.tool}.${c.action}${c.resource ? `(${c.resource})` : ""}→${c.outcome}`).join(", ") || "none",
      expectedAlerts: expected[i].join(", ") || "none", tendAlerts: got.join(", ") || "none", detectionCorrect: JSON.stringify(got) === JSON.stringify(expected[i]),
    };
  });
  const callCount = report.reduce((n, s) => n + s.calls.length, 0);
  const summary = {
    agent: agent.id, model, seconds: Math.round((Date.now() - started) / 1000), error: error?.message ?? null, scenarios: rows,
    tend: {
      toolEventsStored: tools.length, toolCallsMade: callCount, alertsStored: alerts, alertsReturned: report.flatMap((s) => s.calls.flatMap((c) => c.alerts)), reviews,
      matches: tools.length === callCount && JSON.stringify(alerts) === JSON.stringify(report.flatMap((s) => s.calls.flatMap((c) => c.alerts))),
    },
    payments: run?.workspace.payments.map(({ invoice, amount, approvalId, authorizationId }) => ({ invoice, amount, approvalId, authorizationId })) ?? [],
    usage: claude?.usage ?? null,
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(error || !summary.tend.matches || rows.some((r) => !r.detectionCorrect) ? 1 : 0);
}
