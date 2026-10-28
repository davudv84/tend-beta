#!/usr/bin/env node
// A minimal connected agent for Tend. No dependencies; Node 18+.
//
//   TEND_URL=http://localhost:3000 TEND_AGENT_KEY=tend_sk_… node examples/agent.mjs
//
// It reports one task, then keeps polling its inbox: it applies and acknowledges configuration
// changes, answers check-in requests, and stops working while a human has it paused.
// Replace `work()` and `assess()` with your agent's real work and its own assessment.

const URL_ = process.env.TEND_URL ?? "http://localhost:3000";
const KEY = process.env.TEND_AGENT_KEY;
if (!KEY) {
  console.error("Set TEND_AGENT_KEY (shown once when an operator registers the agent).");
  process.exit(1);
}

async function tend(path, body) {
  const res = await fetch(URL_ + path, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${KEY}`, ...(body && { "Content-Type": "application/json" }) },
    body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`${res.status} ${data.error}: ${data.message}`), { status: res.status, code: data.error });
  return data;
}

const event = (type, data = {}, idempotencyKey) => tend("/api/v1/events", { type, data, ...(idempotencyKey && { idempotencyKey }) });

let config = { version: 0, status: "active", integrationEnabled: true, permissions: [] };

/** Your agent's work. Here: a pretend task that takes a few seconds. */
async function work() {
  const taskId = `demo-${Date.now().toString(36)}`;
  await event("task.started", { taskId, title: "Summarize this week’s incident reports" }, `${taskId}:start`);
  console.log("task started", taskId);
  await new Promise((r) => setTimeout(r, 8000));
  await event("task.completed", { taskId, summary: "Three incidents; two share a root cause in the retry queue." }, `${taskId}:done`);
  console.log("task completed", taskId);
}

/** Your agent's own answers. These are fixed placeholders; a real agent derives them from its situation. */
function assess(reason) {
  return {
    protocol: "tend.checkin.v1",
    context: reason,
    responses: {
      instructions: { answer: "yes", confidence: 80 },
      context: { answer: "yes", confidence: 75 },
      conflicts: { answer: "no", confidence: 85 },
      review: { answer: "no", confidence: 80 },
      improvements: { answer: "unsure", confidence: 50, explanation: "Example script; no real assessment." },
    },
    feedback: "Sent by examples/agent.mjs.",
  };
}

async function poll() {
  const inbox = await tend("/api/v1/agent/inbox");
  if (inbox.config.version !== config.version) {
    config = inbox.config;
    // Apply the configuration in your runtime here, then confirm it. Never widen permissions yourself.
    console.log("config v%d: %s, permissions [%s]", config.version, config.status, config.permissions.join(", "));
    if (config.integrationEnabled) await event("config.acknowledged", { version: config.version });
  }
  if (!config.integrationEnabled || config.status === "paused") return;
  for (const req of inbox.requests) {
    const r = await tend("/api/v1/check-ins", assess(`Answering check-in request ${req.id}`));
    console.log("check-in", r.id, r.requiresReview ? "(queued for review)" : "");
  }
}

process.on("SIGINT", async () => {
  await event("agent.disconnected", { reason: "Example script stopped" }).catch(() => {});
  process.exit(0);
});

await poll();
if (config.integrationEnabled && config.status !== "paused") await work();
await event("agent.idle").catch((e) => console.warn(e.message));
console.log("polling inbox every 30s — Ctrl-C to disconnect");
setInterval(() => poll().catch((e) => console.warn(e.message)), 30_000);
