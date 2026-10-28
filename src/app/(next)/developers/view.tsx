"use client";

import Link from "next/link";
import { useT } from "@/i18n/client";
import type { Dict } from "@/i18n";
import { ADJUSTMENT_KINDS, ANSWERS, PROTOCOL, QUESTIONS } from "@/lib/contract";

type Row = [method: string, path: string, auth: keyof Dict["developers"]["auth"], desc: keyof Dict["developers"]["endpointDesc"]];

const AGENT_ENDPOINTS: Row[] = [
  ["POST", "/api/v1/gateway/requests", "agent", "gatewayRequest"],
  ["POST", "/api/v1/authorizations/:id/token", "agent", "gatewayToken"],
  ["POST", "/api/v1/gateway/execute", "agent", "gatewayExecute"],
  ["GET", "/api/v1/authorizations/:id", "agent", "gatewayStatus"],
  ["POST", "/api/v1/events", "agent", "events"],
  ["POST", "/api/v1/check-ins", "agent", "checkIns"],
  ["GET", "/api/v1/agent/inbox", "agent", "inbox"],
  ["GET", "/api/v1/check-ins", "none", "protocol"],
];

const READ_ENDPOINTS: Row[] = [
  ["GET", "/api/v1/state", "visitor", "state"],
  ["GET", "/api/v1/events?since=<seq>", "visitor", "since"],
  ["GET", "/api/health", "none", "health"],
];

const OPERATOR_ENDPOINTS: Row[] = [
  ["POST", "/api/operator/session", "admin", "session"],
  ["POST", "/api/v1/agents", "operator", "register"],
  ["POST", "/api/v1/agents/:id/keys", "operator", "keys"],
  ["POST", "/api/v1/agents/:id/control", "operator", "control"],
  ["POST", "/api/v1/agents/:id/check-in-requests", "operator", "requests"],
  ["POST", "/api/v1/reviews/:id", "operator", "reviews"],
];

const EVENTS: [keyof Dict["developers"]["events"], string][] = [
  ["task.started", "taskId, title, detail?"],
  ["task.completed", "taskId, summary?"],
  ["task.failed", "taskId, error?"],
  ["tool.called", "tool, action, outcome, resource?, permission?, policy?, approval?, approvalId?, detail?, error?, taskId?"],
  ["agent.idle", "—"],
  ["agent.heartbeat", "—"],
  ["agent.disconnected", "reason?"],
  ["review.requested", "reason, proposedAdjustment?"],
  ["config.acknowledged", "version"],
];

const ERRORS: [string, string, keyof Dict["developers"]["errorRows"]][] = [
  ["400", "invalid_json · invalid_since", 400],
  ["401", "missing_key · invalid_key", 401],
  ["403", "integration_disabled", "403a"],
  ["403", "operator_required · bad_origin", "403b"],
  ["409", "agent_paused", 409],
  ["413", "payload_too_large", 413],
  ["422", "invalid_event · invalid_check_in · invalid_batch", 422],
  ["429", "rate_limited", 429],
];

const QUICKSTART = `export TEND_URL=http://localhost:3000
export TEND_AGENT_KEY=tend_sk_…   # shown once when an operator registers the agent

# 1. Start a task — the agent walks to the Study
curl -X POST "$TEND_URL/api/v1/events" \\
  -H "Authorization: Bearer $TEND_AGENT_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "type": "task.started", "idempotencyKey": "t-42-start",
        "data": { "taskId": "t-42", "title": "Refactor the auth middleware" } }'

# 2. Finish it
curl -X POST "$TEND_URL/api/v1/events" \\
  -H "Authorization: Bearer $TEND_AGENT_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "type": "task.completed", "idempotencyKey": "t-42-done",
        "data": { "taskId": "t-42", "summary": "Split into parseSession() and authorize()." } }'

# 3. Check the inbox for configuration changes and check-in requests
curl "$TEND_URL/api/v1/agent/inbox" -H "Authorization: Bearer $TEND_AGENT_KEY"`;

const RESPONSES = `POST /api/v1/events → 202 Accepted
{ "agentId": "wren",
  "results": [{ "id": "ev_1859…", "seq": 1027, "type": "task.started", "status": "stored" }] }
# Replaying the same idempotencyKey returns the original event with "status": "duplicate".

GET /api/v1/agent/inbox → 200 OK
{ "agentId": "wren",
  "config": { "version": 2, "status": "paused", "integrationEnabled": true, "permissions": [] },
  "requests": [{ "id": "ask_…", "type": "check_in", "requestedAt": "2026-10-25T14:31:02.000Z" }] }

POST /api/v1/events → 409 Conflict
{ "error": "agent_paused", "message": "A human has paused this agent. …" }`;

const CHECK_IN = `curl -X POST "$TEND_URL/api/v1/check-ins" \\
  -H "Authorization: Bearer $TEND_AGENT_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "protocol": "${PROTOCOL}",
    "responses": {
      "instructions": { "answer": "yes", "confidence": 88 },
      "context":      { "answer": "no",  "confidence": 74,
                        "explanation": "No document named “Q3 framework” is in my index." },
      "conflicts":    { "answer": "no",  "confidence": 90 },
      "review":       { "answer": "no",  "confidence": 85 },
      "improvements": { "answer": "no",  "confidence": 70 }
    },
    "feedback": "Two briefs are blocked on the missing document.",
    "proposedAdjustment": { "kind": "context", "title": "Add the Q3 framework to the document index" }
  }'

→ 201 Created
{ "accepted": true, "id": "ev_…", "seq": 1104, "requiresReview": true }`;

const RESPONSE_SCHEMA = {
  type: "object",
  required: ["answer", "confidence"],
  properties: { answer: { type: "string", enum: ANSWERS }, confidence: { type: "number", minimum: 0, maximum: 100 }, explanation: { type: "string" } },
};

const TOOL = JSON.stringify(
  {
    name: "submit_check_in",
    description: "Report operational conditions to human overseers. Reporting only: this tool cannot change your instructions, tools or permissions.",
    input_schema: {
      type: "object",
      required: ["responses"],
      properties: {
        responses: {
          type: "object",
          required: QUESTIONS.map((q) => q.id),
          properties: Object.fromEntries(QUESTIONS.map((q) => [q.id, { description: q.text, ...RESPONSE_SCHEMA }])),
        },
        feedback: { type: "string" },
        reflection: { type: "string", description: "Optional open-ended note about the work. Not used to change anything." },
        context: { type: "string" },
        proposedAdjustment: {
          type: "object",
          properties: { kind: { type: "string", enum: ADJUSTMENT_KINDS }, title: { type: "string" }, detail: { type: "string" }, permission: { type: "string" } },
        },
      },
    },
  },
  null,
  2,
);

function Code({ children, label }: { children: string; label: string }) {
  return (
    <figure className="frame overflow-hidden">
      <figcaption className="border-b border-border px-4 py-2.5 font-mono text-meta text-faint">{label}</figcaption>
      <pre className="overflow-x-auto p-4 font-mono text-caption leading-relaxed text-muted-foreground">{children}</pre>
    </figure>
  );
}

function H2({ children, id }: { children: React.ReactNode; id?: string }) {
  return <h2 id={id} className="mb-4 scroll-mt-8 text-title font-semibold">{children}</h2>;
}

function Endpoints({ rows }: { rows: Row[] }) {
  const d = useT().developers;
  return (
    <div className="frame overflow-hidden">
      {rows.map(([m, path, auth, key]) => (
        <div key={m + path} className="grid gap-1 border-b border-border px-4 py-3 last:border-0 sm:grid-cols-[3.5rem_1fr] sm:gap-x-4">
          <span className={m === "POST" ? "font-mono text-small text-sage" : "font-mono text-small text-muted-foreground"}>{m}</span>
          <span className="min-w-0">
            <span className="block font-mono text-small break-all">{path}</span>
            <span className="mt-1 block text-small leading-relaxed text-muted-foreground">{d.endpointDesc[key]} <span className="font-mono text-meta text-faint">· {d.auth[auth]}</span></span>
          </span>
        </div>
      ))}
    </div>
  );
}

function Table({ rows, cols = "sm:grid-cols-[11rem_9rem_1fr]" }: { rows: [string, string, string][]; cols?: string }) {
  return (
    <div className="frame overflow-hidden">
      {rows.map(([a, b, c]) => (
        <div key={a + b} className={`grid gap-1 border-b border-border px-4 py-3 last:border-0 sm:gap-4 ${cols}`}>
          <span className="font-mono text-small break-all">{a}</span>
          <span className="font-mono text-meta text-faint sm:pt-px">{b}</span>
          <span className="text-small leading-relaxed text-muted-foreground">{c}</span>
        </div>
      ))}
    </div>
  );
}

export default function View() {
  const t = useT();
  const d = t.developers;
  const code = (c: string) => <span className="font-mono text-small text-foreground">{c}</span>;
  const fields: [string, string, string][] = [
    ["protocol", "string", d.fields.protocol(PROTOCOL)],
    ["responses", "object", d.fields.responses(ANSWERS.join(" | "))],
    ["feedback", "string?", d.fields.feedback],
    ["context", "string?", d.fields.context],
    ["reflection", "string?", d.fields.reflection],
    ["proposedAdjustment", "object?", d.fields.proposedAdjustment(ADJUSTMENT_KINDS.join(" | "))],
  ];
  return (
    <div>
      <header className="mb-12">
        <h1 className="text-section text-balance">{d.title}</h1>
        <p className="mt-4 max-w-[58ch] text-lead text-pretty text-muted-foreground">{d.intro} {code(PROTOCOL)}.</p>
      </header>

      <section className="mb-12">
        <H2>{d.gateway.title}</H2>
        <p className="text-body text-pretty text-muted-foreground">{d.gateway.body}</p>
        <ol className="mt-5 grid gap-3 text-body text-pretty text-muted-foreground">
          {d.gateway.steps.map((step, i) => <li key={step} className="flex gap-3"><span className="w-5 shrink-0 text-faint tabular-nums">{i + 1}</span><span>{step}</span></li>)}
        </ol>
        <p className="mt-5 text-small text-pretty text-muted-foreground">{d.gateway.note}</p>
      </section>

      <section className="mb-12">
        <H2>{d.s1}</H2>
        <p className="text-body leading-relaxed text-muted-foreground">
          {d.s1body[0]} <Link href="/connect" className="text-primary underline-offset-4 hover:underline">{d.s1body[1]}</Link>{d.s1body[2]} <span className="font-mono text-meta text-foreground">{t.origin.connected}</span>{d.s1body[3]}
        </p>
      </section>

      <section className="mb-12 grid gap-4">
        <H2>{d.s2}</H2>
        <p className="text-body leading-relaxed text-muted-foreground">
          {d.s2body[0]} {code("Authorization: Bearer tend_sk_…")}{d.s2body[1]} {code("idempotencyKey")}{d.s2body[2]}
        </p>
        <Code label={d.quickstart}>{QUICKSTART}</Code>
        <Code label={d.responses}>{RESPONSES}</Code>
        <p className="text-body leading-relaxed text-muted-foreground">
          {d.example[0]} {code("examples/agent.mjs")}{d.example[1]} {code("TEND_URL=… TEND_AGENT_KEY=… node examples/agent.mjs")}{d.example[2]}
        </p>
      </section>

      <section className="mb-12">
        <H2>{d.eventTypes}</H2>
        <Table rows={EVENTS.map(([type, fields]) => [type, fields, d.events[type]])} />
      </section>

      <section className="mb-12 grid gap-4">
        <H2>{d.s3}</H2>
        <p className="text-body leading-relaxed text-muted-foreground">
          {d.s3body[0]} {code("GET /api/v1/agent/inbox")} {d.s3body[1]} {code("config.acknowledged")}{d.s3body[2]}
        </p>
      </section>

      <section className="mb-12 grid gap-4">
        <H2>{d.s4}</H2>
        <Table rows={fields} cols="sm:grid-cols-[11rem_5rem_1fr]" />
        <ol className="frame overflow-hidden">
          {QUESTIONS.map((q) => (
            <li key={q.id} className="grid gap-1 border-b border-border px-4 py-3 last:border-0 sm:grid-cols-[11rem_1fr] sm:gap-4">
              <span className="font-mono text-small">{q.id}</span>
              <span className="text-small text-muted-foreground">{t.questions[q.id].text}</span>
            </li>
          ))}
        </ol>
        <p className="text-body leading-relaxed text-muted-foreground">{d.reviewRule}</p>
        <Code label={d.checkIn}>{CHECK_IN}</Code>
      </section>

      <section className="mb-12">
        <H2>{d.errors}</H2>
        <p className="mb-4 text-body leading-relaxed text-muted-foreground">{d.errorsBody} {code("{ error, message, errors? }")}.</p>
        <Table rows={ERRORS.map(([status, codes, key]) => [status, codes, d.errorRows[key]])} cols="sm:grid-cols-[3rem_14rem_1fr]" />
      </section>

      <section className="mb-12 grid gap-6">
        <div>
          <H2>{d.endpoints}</H2>
          <p className="mb-3 eyebrow">{d.forAgents}</p>
          <Endpoints rows={AGENT_ENDPOINTS} />
        </div>
        <div>
          <p className="mb-3 eyebrow">{d.readOnly}</p>
          <Endpoints rows={READ_ENDPOINTS} />
        </div>
        <div>
          <p className="mb-3 eyebrow">{d.forOperators}</p>
          <Endpoints rows={OPERATOR_ENDPOINTS} />
          <p className="mt-3 text-small leading-relaxed text-faint">{d.operatorNote}</p>
        </div>
      </section>

      <section className="mb-12">
        <H2>{d.guarantees}</H2>
        <ul className="grid gap-2.5">
          {d.rules.map((r) => (
            <li key={r} className="flex gap-3 text-body leading-relaxed text-muted-foreground"><span className="mt-2 size-1 shrink-0 rounded-full bg-sage" />{r}</li>
          ))}
        </ul>
      </section>

      <section>
        <H2>{d.tool}</H2>
        <p className="mb-4 text-body leading-relaxed text-muted-foreground">
          {d.toolBody[0]} <span className="font-mono text-small">/api/v1/check-ins</span> {d.toolBody[1]} <span className="font-mono text-small">parameters</span>{d.toolBody[2]}
        </p>
        <Code label={d.toolLabel}>{TOOL}</Code>
      </section>
    </div>
  );
}
