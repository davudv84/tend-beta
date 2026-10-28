#!/usr/bin/env node
// A tiny agent for demonstrations: it asks Tend to run ONE action and prints exactly what happened. No model, no
// dependencies. It uses the same gateway client as the Claude example, so every action really goes through Tend.
//
//   TEND_URL=http://localhost:3000 TEND_AGENT_KEY=tend_sk_… node examples/demo-agent.mjs <action> [args]
//
//   list                       list the notes          (runs without asking if the operator allowed it)
//   write <name> "<text>"      write a note            (waits for the operator if set to "Ask me first")
//   pay <invoice>              pay an invoice          (always waits; the payments API is a fake and moves no money)
//   erase                      an action Tend does not know (always refused)
import { tendHttp } from "./claude-agent/agent.mjs";
import { createGateway } from "./claude-agent/gateway-client.mjs";

const url = process.env.TEND_URL ?? "http://localhost:3000", key = process.env.TEND_AGENT_KEY;
if (!key) { console.error("Set TEND_AGENT_KEY (shown once when the assistant is created)."); process.exit(1); }
const [action, a, b] = process.argv.slice(2);
const plans = {
  list: ["list_notes", {}],
  write: ["write_note", { name: a ?? "demo-note", text: b ?? "Written by the demo agent." }],
  pay: ["pay_invoice", { invoice: a ?? "INV-2041", amountCents: 48000, currency: "EUR", payee: "PAYEE-1" }],
  erase: ["erase_everything", {}],
};
if (!plans[action]) { console.error("Usage: demo-agent.mjs list | write <name> \"<text>\" | pay <invoice> | erase"); process.exit(1); }
const [tool, params] = plans[action];
const gateway = createGateway({ tend: tendHttp(url, key), approvalTimeoutMs: 5 * 60_000, onPending: () => console.log(`Asked Tend to run ${tool}. Waiting for a person to decide…`) });
const r = await gateway.run(tool, params);
console.log(r.executed ? `Tend ran ${tool}. Result: ${JSON.stringify(r.result ?? r.output ?? {})}` : `Not run: ${r.outcome}${r.reason ? ` (${r.reason})` : ""}.`);
process.exit(r.executed ? 0 : 3);
