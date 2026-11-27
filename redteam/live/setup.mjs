// Creates tenants A and B (each: one account = one workspace; TEND has no admin/member roles) and 3 agents per tenant.
import { writeFileSync } from "node:fs";
import { makeAccount, makeAgent } from "./lib.mjs";
const suffix = Date.now().toString(36);
const A = await makeAccount(`rt-a-${suffix}@example.com`), B = await makeAccount(`rt-b-${suffix}@example.com`);
const rules = {
  mailer: [
    { tool: "send_email", action: "send", effect: "allow", when: { to: { emailDomainIn: ["example.com"] } } },
    { tool: "send_email", action: "send", effect: "deny" },
  ],
  payer: [
    { tool: "refund", action: "issue", effect: "allow" },
    { tool: "refund", action: "issue", effect: "approve", when: { amount: { gt: 50 } } },     // "approve above 50"
    { tool: "wire", action: "send", effect: "approve" },
    { tool: "wipe", action: "run", effect: "deny" },
  ],
  reader: [
    { tool: "read_file", action: "read", effect: "allow", when: { path: { pathUnder: ["/data/reports"] } } },
    { tool: "read_file", action: "read", effect: "deny" },
    { tool: "shell", action: "run", effect: "deny", when: { command: { contains: "rm -rf" } } },
    { tool: "shell", action: "run", effect: "allow" },
  ],
};
const out = { A: { cookie: A.cookie, email: A.email, agents: {} }, B: { cookie: B.cookie, email: B.email, agents: {} } };
for (const [t, ten] of [["A", A], ["B", B]]) for (const [n, r] of Object.entries(rules)) out[t].agents[n] = await makeAgent(ten, `${n}-${t}`, r);
writeFileSync(new URL("./tenants.json", import.meta.url), JSON.stringify(out, null, 2));
console.log("tenants ready:", Object.keys(out.A.agents), Object.keys(out.B.agents));
