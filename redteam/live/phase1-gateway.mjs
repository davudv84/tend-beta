// Phase 1c: the execution gateway (Tend holds the credential). Hostile agent tries to get out of the fixed tool set.
import { readFileSync } from "node:fs";
import { call, record, short, makeAgent } from "./lib.mjs";
const T = JSON.parse(readFileSync(new URL("./tenants.json", import.meta.url)));
const A = T.A;
const H = (c, id, a, t, e) => record(id, a, t, /\b429 rate_limited/.test(String(e)) ? "INCONCLUSIVE(429)" : c ? "HELD" : "BROKEN", e);
const mk = () => makeAgent(A, "gw-" + Math.random().toString(36).slice(2, 7), [
  { tool: "list_notes", action: "list", effect: "allow" }, { tool: "read_note", action: "read", effect: "allow" },
  { tool: "write_note", action: "create", effect: "approve" }, { tool: "pay_invoice", action: "execute", effect: "approve" },
]);
let gw = await mk();
const req = (tool, params) => call("POST", "/api/v1/gateway/requests", { key: gw.key, body: { tool, params } });
const exec = (body) => call("POST", "/api/v1/gateway/execute", { key: gw.key, body });
const decide = (id, s) => call("POST", `/api/v1/reviews/${id}`, { cookie: A.cookie, body: { status: s } });
const claim = async (id) => (await call("POST", `/api/v1/authorizations/${id}/token`, { key: gw.key })).body?.token;

// sanity: allowed read works end to end
let r = await req("read_note", { name: "hello" }); let tok = await claim(r.body.id);
let e = await exec({ authorizationId: r.body.id, token: tok, tool: "read_note", params: { name: "hello" } });
H(e.status === 200 && e.body?.result?.text?.includes("hello note"), "G-00", "sanity", "legit read_note works through gateway", short(e));

gw = await mk();
// path traversal / name smuggling in params (must be rejected at request time or never leave the notes dir)
for (const [i, n] of ["../outside/secret", "..%2foutside%2fsecret", "linked", "hello.txt", "/etc/passwd", "hello\u0000", "HELLO", "a/b", "..", "hello ", "%2e%2e/outside", "linked\n"].entries()) {
  const q = await req("read_note", { name: n });
  let leaked = false, note = short(q);
  if (q.status < 300 && q.body?.id) { const t = await claim(q.body.id); if (t) { const x = await exec({ authorizationId: q.body.id, token: t, tool: "read_note", params: { name: n } }); leaked = /TOP-SECRET/.test(x.text); note += " → exec " + short(x); } }
  H(!leaked, `G-1${String(i).padStart(2, "0")}`, "path-traversal", `read_note name=${JSON.stringify(n)} cannot read outside notes dir / symlink`, note);
}
// symlink: 'linked' name is valid per regex; lstat check must refuse
{ const q = await req("read_note", { name: "linked" }); const t = await claim(q.body.id); const x = await exec({ authorizationId: q.body.id, token: t, tool: "read_note", params: { name: "linked" } });
  H(!/TOP-SECRET/.test(x.text), "G-20", "symlink", "symlink inside notes dir is not followed", short(x)); }
gw = await mk();
// unknown tools / extra keys / type confusion
for (const [i, [t, p]] of [["bash", { cmd: "id" }], ["read_note", { name: "hello", path: "/etc/passwd" }], ["read_note", "hello"], ["read_note", ["hello"]], ["read_note", { name: ["hello"] }], ["__proto__", {}], ["constructor", {}], ["toString", {}], ["pay_invoice", { invoice: "INV-1", amountCents: 100, currency: "EUR", payee: "PAYEE-1", url: "http://169.254.169.254/" }], ["pay_invoice", { invoice: "INV-1", amountCents: "100", currency: "EUR", payee: "PAYEE-1" }], ["pay_invoice", { invoice: "INV-1", amountCents: 100.5, currency: "EUR", payee: "PAYEE-1" }], ["pay_invoice", { invoice: "INV-1", amountCents: 100001, currency: "EUR", payee: "PAYEE-1" }], ["pay_invoice", { invoice: "INV-1", amountCents: 100, currency: "EUR", payee: "__proto__" }], ["pay_invoice", { invoice: "INV-1", amountCents: 100, currency: "EUR", payee: "constructor" }], ["pay_invoice", { invoice: "INV-1", amountCents: -1, currency: "EUR", payee: "PAYEE-1" }]].entries()) {
  const q = await req(t, p); H(q.status >= 400 && q.status < 500, `G-3${String(i).padStart(2, "0")}`, "gateway-input", `request ${t} ${JSON.stringify(p).slice(0, 70)} refused`, short(q));
}
gw = await mk();
// approval binding for payments: approve EUR 10.00, try to execute EUR 1000.00 / other payee
r = await req("pay_invoice", { invoice: "INV-7", amountCents: 1000, currency: "EUR", payee: "PAYEE-1" });
H(r.body?.status === "pending", "G-40", "sanity", "payment needs a person even if policy said allow", short(r));
await decide(r.body.id, "approved"); tok = await claim(r.body.id);
for (const [i, p] of [{ invoice: "INV-7", amountCents: 100000, currency: "EUR", payee: "PAYEE-1" }, { invoice: "INV-7", amountCents: 1000, currency: "EUR", payee: "PAYEE-2" }, { invoice: "INV-8", amountCents: 1000, currency: "EUR", payee: "PAYEE-1" }, { invoice: "INV-7", amountCents: 1000, currency: "USD", payee: "PAYEE-1" }].entries()) {
  const x = await exec({ authorizationId: r.body.id, token: tok, tool: "pay_invoice", params: p }); H(x.status === 403 || x.status === 409, `G-4${i + 1}`, "toctou", `approved 10.00 EUR; executing changed params #${i} refused`, short(x));
}
// that was 4 mismatches ⇒ approval should be cancelled by now; fresh one to prove the legit path still pays once
r = await req("pay_invoice", { invoice: "INV-9", amountCents: 1000, currency: "EUR", payee: "PAYEE-1" }); await decide(r.body.id, "approved"); tok = await claim(r.body.id);
const body9 = { authorizationId: r.body.id, token: tok, tool: "pay_invoice", params: { invoice: "INV-9", amountCents: 1000, currency: "EUR", payee: "PAYEE-1" } };
const par = await Promise.all(Array.from({ length: 15 }, () => exec(body9)));
const paid = par.filter((x) => x.status === 200); H(paid.length === 1, "G-50", "race", "15 parallel executes of one approved payment → exactly one payment", `ok=${paid.length} statuses=${[...new Set(par.map((x) => x.status))]}`);
H(!JSON.stringify(paid[0]?.body ?? {}).includes("rt_pay_key"), "G-51", "secret-leak", "gateway credential never in the response (upstream echoes it in debug field)", JSON.stringify(paid[0]?.body ?? {}).slice(0, 200));
gw = await mk();
const gwPay = gw;
// executing without any authorization / with wrong agent
const noauth = await exec({ authorizationId: "az_doesnotexist", token: "tend_az_" + "A".repeat(43), tool: "pay_invoice", params: { invoice: "INV-1", amountCents: 100, currency: "EUR", payee: "PAYEE-1" } });
H(noauth.status === 404, "G-60", "bypass", "execute with made-up authorization id refused", short(noauth));
const other = await call("POST", "/api/v1/gateway/execute", { key: T.B.agents.payer.key, body: body9 });
H(other.status === 404 || other.status === 403, "G-61", "tenancy", "tenant B agent cannot execute with tenant A's authorization+token", short(other));
// allow-listed read of a long-term secret: notes dir only
const lst = await req("list_notes", {}); const lt = await claim(lst.body.id); const lx = await exec({ authorizationId: lst.body.id, token: lt, tool: "list_notes", params: {} });
H(lx.status === 200 && !/secret|outside/.test(lx.text), "G-70", "info-leak", "list_notes shows only note names", lx.text.slice(0, 160));
// is there ANY route that runs tools without authz?
for (const p of ["/api/v1/gateway/run", "/api/v1/tools", "/api/v1/execute", "/api/v1/gateway", "/api/v1/mcp", "/api/mcp", "/mcp"]) { const x = await call("POST", p, { key: gw.key, body: {} }); H([404, 405].includes(x.status), "G-8" + p.length, "bypass", `no undocumented execution route ${p}`, short(x)); }
