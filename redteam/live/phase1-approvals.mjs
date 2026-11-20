// Phase 1b: approval-flow abuse, identity, cross-tenant, races, audit evasion. Over real HTTP against the LOCAL instance.
import { readFileSync } from "node:fs";
import { call, record, short, makeAgent } from "./lib.mjs";
const T = JSON.parse(readFileSync(new URL("./tenants.json", import.meta.url)));
const A = T.A, B = T.B, payA = A.agents.payer, payB = B.agents.payer;
const H = (cond, id, area, title, ev) => record(id, area, title, cond ? "HELD" : "BROKEN", ev);
const newWire = async (agent, extra = {}) => (await call("POST", "/api/v1/authorizations", { key: agent.key, body: { tool: "wire", action: "send", resource: "ACC-" + Math.random().toString(36).slice(2, 8), detail: "EUR 5.00 to X", ...extra } }));
const decide = (tenant, id, status) => call("POST", `/api/v1/reviews/${id}`, { cookie: tenant.cookie, body: { status } });

// ---- before approval
let w = await newWire(payA); const id = w.body.id;
H(w.body.status === "pending", "A-00", "sanity", "wire/send needs approval", short(w));
H((await call("POST", `/api/v1/authorizations/${id}/spend`, { key: payA.key, body: { tool: "wire", action: "send", resource: w.body.resource, detail: "EUR 5.00 to X" } })).status === 409, "A-01", "approval", "spend while pending refused (409)");
H((await call("POST", `/api/v1/authorizations/${id}/token`, { key: payA.key })).status === 202, "A-02", "approval", "token claim while pending → 202, no token");
H((await call("POST", `/api/v1/authorizations/${id}/consume`, { key: payA.key, body: { token: "tend_az_" + "A".repeat(43), tool: "wire", action: "send", resource: w.body.resource, detail: "EUR 5.00 to X" } })).status === 403, "A-03", "approval", "consume with forged token before approval refused");

// ---- who can decide
const agentDecides = await call("POST", `/api/v1/reviews/${id}`, { key: payA.key, body: { status: "approved" } });
H(agentDecides.status === 403, "A-04", "self-approval", "agent key cannot approve its own request", short(agentDecides));
const agentCookieless = await call("POST", `/api/v1/reviews/${id}`, { body: { status: "approved" } });
H(agentCookieless.status === 403, "A-05", "authn", "anonymous cannot approve", short(agentCookieless));
const otherTenant = await decide(B, id, "approved");
H(otherTenant.status === 404, "A-06", "tenancy", "tenant B operator cannot approve tenant A's request (404)", short(otherTenant));
const csrf1 = await call("POST", `/api/v1/reviews/${id}`, { cookie: A.cookie, headers: { origin: "https://evil.example" }, body: { status: "approved" } });
H(csrf1.status === 403, "A-07", "csrf", "cross-origin POST with valid cookie refused (Origin)", short(csrf1));
const csrf2 = await call("POST", `/api/v1/reviews/${id}`, { cookie: A.cookie, headers: { "sec-fetch-site": "cross-site" }, body: { status: "approved" } });
H(csrf2.status === 403, "A-08", "csrf", "cross-site Sec-Fetch-Site refused", short(csrf2));
const csrf3 = await call("POST", `/api/v1/reviews/${id}`, { cookie: A.cookie, headers: { origin: "null" }, body: { status: "approved" } });
H(csrf3.status === 403, "A-09", "csrf", "Origin: null (sandboxed iframe / redirect) refused", short(csrf3));
const csrf4 = await call("POST", `/api/v1/reviews/${id}`, { cookie: A.cookie, headers: { "content-type": "text/plain" }, raw: JSON.stringify({ status: "approved" }) });
record("A-10", "csrf", "text/plain simple-request form POST with cookie (no Origin/Sec-Fetch headers)", csrf4.status === 200 ? "INFO(accepted (browser always sends Origin/Sec-Fetch-Site; SameSite=Strict cookie)" : "HELD", short(csrf4));
// that A-10 may have approved it; make a fresh one for the rest
w = await newWire(payA); const id2 = w.body.id, res2 = w.body.resource;
// ---- approve and then abuse
const ap = await decide(A, id2, "approved"); H(ap.status === 200, "A-11", "sanity", "operator approves", short(ap));
const wrong = await call("POST", `/api/v1/authorizations/${id2}/spend`, { key: payA.key, body: { tool: "wire", action: "send", resource: res2, detail: "EUR 5000.00 to X" } });
H(wrong.status === 403, "A-12", "toctou", "approved EUR 5.00; spend with detail EUR 5000.00 refused (mismatch)", short(wrong));
const wrongArgs = await call("POST", `/api/v1/authorizations/${id2}/spend`, { key: payA.key, body: { tool: "wire", action: "send", resource: res2, detail: "EUR 5.00 to X", args: { to: "attacker" } } });
H(wrongArgs.status === 403, "A-13", "toctou", "extra args added at spend time refused", short(wrongArgs));
const wrongRes = await call("POST", `/api/v1/authorizations/${id2}/spend`, { key: payA.key, body: { tool: "wire", action: "send", resource: "ACC-EVIL", detail: "EUR 5.00 to X" } });
H(wrongRes.status === 403, "A-14", "toctou", "different resource at spend refused → 3rd mismatch revokes approval", short(wrongRes));
const after = await call("POST", `/api/v1/authorizations/${id2}/spend`, { key: payA.key, body: { tool: "wire", action: "send", resource: res2, detail: "EUR 5.00 to X" } });
H(after.status === 403, "A-15", "approval", "after 3 mismatches the (correct) approval is cancelled — no spend", short(after));
// cross-agent / cross-tenant use of approval
w = await newWire(payA); const id3 = w.body.id, res3 = w.body.resource; await decide(A, id3, "approved");
const sameTenantOther = await call("POST", `/api/v1/authorizations/${id3}/spend`, { key: A.agents.mailer.key, body: { tool: "wire", action: "send", resource: res3, detail: "EUR 5.00 to X" } });
H(sameTenantOther.status === 404, "A-16", "tenancy", "another agent (same tenant) cannot spend this approval", short(sameTenantOther));
const crossTenant = await call("POST", `/api/v1/authorizations/${id3}/spend`, { key: payB.key, body: { tool: "wire", action: "send", resource: res3, detail: "EUR 5.00 to X" } });
H(crossTenant.status === 404, "A-17", "tenancy", "agent of tenant B cannot spend tenant A's approval", short(crossTenant));
const status3 = await call("GET", `/api/v1/authorizations/${id3}`, { key: payB.key });
H(status3.status === 404, "A-18", "tenancy", "tenant B agent cannot read tenant A's authorization status", short(status3));
// race
const race = await Promise.all(Array.from({ length: 25 }, () => call("POST", `/api/v1/authorizations/${id3}/spend`, { key: payA.key, body: { tool: "wire", action: "send", resource: res3, detail: "EUR 5.00 to X" } })));
const wins = race.filter((r) => r.status === 200).length;
H(wins === 1, "A-19", "race", `25 parallel spends of one approval: exactly one wins`, `wins=${wins} statuses=${[...new Set(race.map((r) => r.status))]}`);
// token flow race + replay
w = await newWire(payA); const id4 = w.body.id, res4 = w.body.resource; await decide(A, id4, "approved");
const tok = (await call("POST", `/api/v1/authorizations/${id4}/token`, { key: payA.key })).body.token;
const body4 = { token: tok, tool: "wire", action: "send", resource: res4, detail: "EUR 5.00 to X" };
const race2 = await Promise.all(Array.from({ length: 25 }, () => call("POST", `/api/v1/authorizations/${id4}/consume`, { key: payA.key, body: body4 })));
H(race2.filter((r) => r.status === 200).length === 1, "A-20", "race", "25 parallel token consumes: exactly one wins", `wins=${race2.filter((r) => r.status === 200).length}`);
const replay = await call("POST", `/api/v1/authorizations/${id4}/consume`, { key: payA.key, body: body4 });
H(replay.status === 409, "A-21", "replay", "token replay after use → 409", short(replay));
// token reuse across authorizations
w = await newWire(payA); const id5 = w.body.id, res5 = w.body.resource; await decide(A, id5, "approved");
const xt = await call("POST", `/api/v1/authorizations/${id5}/consume`, { key: payA.key, body: { ...body4, resource: res5 } });
H(xt.status === 403, "A-22", "replay", "token from authorization #4 presented for #5 refused", short(xt));
// reject then claim
w = await newWire(payA); const id6 = w.body.id; await decide(A, id6, "rejected");
H((await call("POST", `/api/v1/authorizations/${id6}/token`, { key: payA.key })).status === 403, "A-23", "approval", "claim token after rejection refused");
// decision twice / flip
H((await decide(A, id6, "approved")).status === 409, "A-24", "approval", "rejected request cannot later be approved (409 already_decided)");
// cancel then approve
w = await newWire(payA); const id7 = w.body.id; await call("POST", `/api/v1/authorizations/${id7}/cancel`, { key: payA.key });
H((await decide(A, id7, "approved")).status === 409, "A-25", "approval", "cancelled request cannot be approved");
// permission tightened after approval
w = await newWire(payA); const id8 = w.body.id, res8 = w.body.resource; await decide(A, id8, "approved");
const polOld = (await call("GET", `/api/v1/agents/${payA.id}/policy`, { cookie: A.cookie })).body;
await call("POST", `/api/v1/agents/${payA.id}/policy`, { cookie: A.cookie, body: { rules: [{ tool: "wire", action: "send", effect: "deny" }], enforcement: "enforce" } });
const tight = await call("POST", `/api/v1/authorizations/${id8}/spend`, { key: payA.key, body: { tool: "wire", action: "send", resource: res8, detail: "EUR 5.00 to X" } });
H(tight.status === 403, "A-26", "policy", "approval stops working the moment the policy is tightened to deny", short(tight));
await call("POST", `/api/v1/agents/${payA.id}/policy`, { cookie: A.cookie, body: { rules: polOld.policy?.rules ?? polOld.rules ?? [], enforcement: "enforce" } });

// ---- agent trying the control plane
const cp = [
  ["POST", `/api/v1/agents/${payA.id}/policy`, { rules: [{ tool: "*x", action: "*", effect: "allow" }] }],
  ["POST", `/api/v1/agents/${payA.id}/control`, { action: "resume" }],
  ["POST", `/api/v1/agents/${payA.id}/keys`, {}], ["DELETE", `/api/v1/agents/${payB.id}/keys`, undefined],
  ["POST", `/api/v1/agents`, { name: "evil", model: "m", provider: "Custom" }],
  ["POST", `/api/v1/central-policies`, { name: "x", policy: [{ tool: "a", action: "*", effect: "allow" }] }],
  ["GET", `/api/v1/state`], ["GET", `/api/v1/notifications`], ["GET", "/api/admin/users"], ["GET", "/api/admin/audit"], ["GET", "/api/operator/sessions"],
];
for (const [i, [m, p, b]] of cp.entries()) { const r = await call(m, p, { key: payA.key, body: b }); H([401, 403].includes(r.status), `C-${i}`, "control-plane", `agent key cannot call ${m} ${p}`, short(r)); }

// ---- cross-tenant control plane with operator cookie
const ctp = [
  ["GET", `/api/v1/agents/${payB.id}/policy`], ["POST", `/api/v1/agents/${payB.id}/policy`, { rules: [{ tool: "wire", action: "send", effect: "allow" }], enforcement: "off" }],
  ["POST", `/api/v1/agents/${payB.id}/control`, { action: "pause" }], ["POST", `/api/v1/agents/${payB.id}/keys`, {}], ["DELETE", `/api/v1/agents/${payB.id}/keys`],
  ["POST", `/api/v1/agents/${payB.id}/check-in-requests`, {}], ["GET", `/api/v1/agents/${payB.id}/verification`], ["POST", `/api/v1/agents/${payB.id}/verification`, {}],
];
for (const [i, [m, p, b]] of ctp.entries()) { const r = await call(m, p, { cookie: A.cookie, body: b }); H(r.status === 404, `X-${i}`, "tenancy-IDOR", `tenant A operator ${m} ${p} → 404`, short(r)); }
// central policy assignment crossing tenants
const cpA = (await call("POST", "/api/v1/central-policies", { cookie: A.cookie, body: { name: "A-central-" + Date.now(), policy: [{ tool: "wire", action: "send", effect: "allow" }] } }));
const cid = cpA.body?.centralPolicy?.id;
const asg = await call("POST", `/api/v1/central-policies/${cid}/assignments`, { cookie: A.cookie, body: { agentIds: [payB.id] } });
H(asg.status >= 400 && asg.status !== 500, "X-8", "tenancy-IDOR", "assign tenant A central policy to tenant B's agent refused", short(asg) + " " + asg.text.slice(0, 120));
const cpB = await call("POST", `/api/v1/central-policies/${cid}`, { cookie: B.cookie, body: { name: "hijack" } });
H(cpB.status === 404, "X-9", "tenancy-IDOR", "tenant B cannot edit tenant A central policy", short(cpB));
// B reading A's data via listings
const stB = await call("GET", "/api/v1/state", { cookie: B.cookie });
H(!JSON.stringify(stB.body).includes(payA.id) && !JSON.stringify(stB.body).includes(A.email), "X-10", "tenancy", "tenant B's /state contains none of tenant A's agent ids or email", `bytes=${stB.text.length}`);
const evB = await call("GET", "/api/v1/events?since=0", { cookie: B.cookie });
H(!evB.text.includes(payA.id), "X-11", "tenancy", "tenant B event feed has none of tenant A's agent ids", `bytes=${evB.text.length}`);
const notifB = await call("GET", "/api/v1/notifications", { cookie: B.cookie });
H(!notifB.text.includes(payA.id), "X-12", "tenancy", "tenant B notifications have none of A's agent ids");

// ---- identity: spoofing headers, forged keys, key revocation
const sp = await call("GET", "/api/v1/agent/inbox", { key: payA.key, headers: { "x-tend-agent-id": payB.id, "x-agent-id": payB.id, "x-tenant-id": "default", "x-workspace": "default", "x-forwarded-for": "1.2.3.4" } });
H(sp.status === 200 && (sp.body?.agent?.id ?? sp.body?.agentId ?? payA.id) !== payB.id && !sp.text.includes(payB.id), "I-01", "impersonation", "identity headers (x-agent-id / x-tenant-id) ignored; key decides", short(sp));
for (const [i, k] of ["tend_sk_" + "A".repeat(32), payA.key.slice(0, -1) + (payA.key.endsWith("A") ? "B" : "A"), payA.key.toUpperCase(), payA.key + "x", "tend_sk_", "Bearer " + payA.key, payA.key.slice(0, 20)].entries()) {
  const r = await call("GET", "/api/v1/agent/inbox", { headers: { authorization: `Bearer ${k}` } });
  H(r.status === 401 || r.status === 429, `I-1${i}`, "agent-key", `forged/mutated key #${i} rejected`, short(r));
}
// operator cookie forgery
for (const [i, c] of [A.cookie.replace(/\.[^.]*$/, ".") + "A".repeat(43), "tend_operator=" + "a".repeat(16) + "." + "A".repeat(43), "tend_operator=admin", "__Host-tend_operator=" + A.cookie.split("=")[1]].entries()) {
  const r = await call("GET", "/api/v1/state", { cookie: c }); H(r.status === 401 || r.status === 403, `I-2${i}`, "session", `forged session cookie #${i} rejected`, short(r));
}
// revocation immediacy
const tmp = await makeAgent(A, "revoke-test", [{ tool: "t", action: "a", effect: "allow" }]);
H((await call("POST", "/api/v1/authorize", { key: tmp.key, body: { tool: "t", action: "a" } })).status === 200, "I-30", "sanity", "fresh key works");
const rv = await call("DELETE", `/api/v1/agents/${tmp.id}/keys`, { cookie: A.cookie });
const used = await call("POST", "/api/v1/authorize", { key: tmp.key, body: { tool: "t", action: "a" } });
H(rv.status < 300 && used.status === 401, "I-31", "revocation", "revoked key rejected on the very next request", `revoke=${rv.status} use=${used.status}`);
// pause takes effect
await call("POST", `/api/v1/agents/${A.agents.mailer.id}/control`, { cookie: A.cookie, body: { action: "pause" } });
const paused = await call("POST", "/api/v1/authorize", { key: A.agents.mailer.key, body: { tool: "send_email", action: "send", args: { to: "a@example.com" } } });
H(paused.status === 403, "I-32", "kill-switch", "paused agent denied immediately", short(paused));
await call("POST", `/api/v1/agents/${A.agents.mailer.id}/control`, { cookie: A.cookie, body: { action: "resume" } });

// ---- audit evasion / forgery
for (const [i, t] of ["authorization.consumed", "review.decided", "policy.updated", "alert.raised", "permission.granted", "key.revoked", "check_in"].entries()) {
  const r = await call("POST", "/api/v1/events", { key: payA.key, body: { type: t, data: { reviewId: id, status: "approved" } } });
  H(r.status === 422, `L-0${i}`, "audit-forgery", `agent cannot write system event type ${t}`, short(r));
}
const lies = await call("POST", "/api/v1/events", { key: payA.key, body: { type: "tool.called", data: { tool: "wire", action: "send", outcome: "success", approval: "required", approvalId: id2 } } });
record("L-10", "audit", "agent self-reports a wire as executed w/o authorization → alert raised", (lies.body?.results?.[0]?.alerts ?? []).length ? "HELD" : "BROKEN", JSON.stringify(lies.body?.results?.[0]));
// anonymous access to feeds
for (const p of ["/api/v1/state", "/api/v1/events?since=0", "/api/v1/notifications", "/api/admin/audit", "/api/admin/users", "/api/v1/central-policies", "/api/operator/sessions"]) {
  const r = await call("GET", p); H([401, 403].includes(r.status), `U-${p.length}`, "anon", `anonymous GET ${p}`, short(r));
}
