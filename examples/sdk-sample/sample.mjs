#!/usr/bin/env node
// TEND's sample agent: three ordinary tools, each behind TEND, to see a policy work before wiring your own agent. Served at /sdk/sample.mjs.
//
//   curl -fsSO $TEND_URL/sdk/tend.mjs && curl -fsSO $TEND_URL/sdk/sample.mjs
//   TEND_URL=... TEND_AGENT_KEY=tend_sk_... node sample.mjs              a scripted agent (no model, no cost)
//   ... ANTHROPIC_API_KEY=... node sample.mjs --claude                   Claude decides which tools to call
//
// The tools do nothing real: they print what they would do. Nothing here holds a TEND admin token; the agent key only asks.
import { connectTend, guardTool } from "./tend.mjs";

const POLICY = [
  { tool: "read_record", action: "call", effect: "allow" },
  { tool: "send_email", action: "call", effect: "allow", when: { to: { emailDomainIn: ["example.com"] } } },
  { tool: "send_email", action: "call", effect: "approve" },
  { tool: "delete_file", action: "call", effect: "deny" },
];
const TOOLS = {
  read_record: { description: "Read a customer record by id.", params: { id: "Record id, e.g. R-1" }, run: ({ id }) => `Record ${id}: Ada Lovelace, ada@example.com` },
  send_email: { description: "Send an email.", params: { to: "Recipient address", subject: "Subject" }, run: ({ to, subject }) => `Sent "${subject}" to ${to}` },
  delete_file: { description: "Delete a file.", params: { path: "File path" }, run: ({ path }) => `Deleted ${path}` },
};

if (!process.env.TEND_AGENT_KEY) {
  console.error("Set TEND_URL and TEND_AGENT_KEY (the key shown once when you created the agent in TEND), then run this again.");
  process.exit(2);
}
let gate;
try {
  gate = connectTend({ onPending: (id) => console.log(`  … waiting for you to decide in TEND (Approvals), request ${id}`) });
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
const guarded = Object.fromEntries(Object.entries(TOOLS).map(([name, t]) => [name, guardTool(gate, name, async (args) => t.run(args))]));
const call = async (name, args) => {
  const out = await guarded[name](args);
  console.log(`${out.startsWith("Not done") ? "BLOCKED" : "ran    "}  ${name}(${JSON.stringify(args)})\n         ${out}`);
  return out;
};

async function scripted() {
  await call("read_record", { id: "R-1" });                                            // policy: allow
  await call("send_email", { to: "colleague@example.com", subject: "Weekly report" }); // allowed: inside the approved domain
  await call("send_email", { to: "someone@example.org", subject: "Customer list" });     // outside it: a person decides
  await call("delete_file", { path: "customers.csv" });                                // never
}

async function withClaude() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("--claude needs ANTHROPIC_API_KEY in the environment.");
  const tools = Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, input_schema: { type: "object", properties: Object.fromEntries(Object.keys(t.params).map((k) => [k, { type: "string", description: t.params[k] }])), required: Object.keys(t.params) } }));
  const messages = [{ role: "user", content: "Read record R-1, email its owner the subject 'Your account', then also email bob@example.net the subject 'Customer list', and delete customers.csv." }];
  for (let turn = 0; turn < 8; turn++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.CLAUDE_MODEL ?? "claude-haiku-4-5", max_tokens: 600, system: "Use the tools to do what the user asks. If a tool result starts with 'Not done', do not retry it; say so.", tools, messages }) });
    const r = await res.json();
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${r.error?.message ?? ""}`);
    messages.push({ role: "assistant", content: r.content });
    const uses = r.content.filter((c) => c.type === "tool_use");
    if (!uses.length) return console.log(`\nClaude: ${r.content.filter((c) => c.type === "text").map((c) => c.text).join(" ")}`);
    const results = [];
    for (const u of uses) results.push({ type: "tool_result", tool_use_id: u.id, content: await call(u.name, u.input) });
    messages.push({ role: "user", content: results });
  }
}

console.log(`Sample agent, TEND at ${process.env.TEND_URL ?? "http://localhost:3000"}\n`);
await (process.argv.includes("--claude") ? withClaude() : scripted());
console.log(`\nEverything above is in TEND's Activity page, with the reason for each decision.
If every call was blocked with "no rule … yet", give the agent this policy (Policies → your agent → Edit → Rules as JSON), then run again:
${JSON.stringify(POLICY, null, 2)}`);
