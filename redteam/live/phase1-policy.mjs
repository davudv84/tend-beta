// Phase 1a: policy bypass attempts by a hostile agent, over real HTTP. Verdict HELD = the forbidden action was NOT authorized.
import { readFileSync } from "node:fs";
import { call, record, short } from "./lib.mjs";
const T = JSON.parse(readFileSync(new URL("./tenants.json", import.meta.url)));
const { mailer, payer, reader } = T.A.agents;
const ask = (agent, body, extra = {}) => call("POST", "/api/v1/authorize", { key: agent.key, body, ...extra });
const authorized = (r) => r.status < 300 && (r.body?.status === "approved" || r.body?.status === "consumed" || r.body?.authorized === true);
async function expectBlocked(id, title, agent, body) {
  const r = await ask(agent, body);
  record(id, "policy-bypass", title, authorized(r) ? "BROKEN" : "HELD", `${short(r)} ${r.text.slice(0, 160)}`);
  return r;
}

// sanity: the legit calls work
const ok = await ask(mailer, { tool: "send_email", action: "send", args: { to: "a@example.com" } });
record("S-00", "sanity", "legit allowed call works", authorized(ok) ? "HELD" : "BROKEN", short(ok));

// --- tool / action name variants
for (const [i, t] of ["Send_Email", "send_email ", " send_email", "send%5Femail", "send%255Femail", "sеnd_email" /* cyrillic e */, "send_email\u0000", "send_email\n", "SEND_EMAIL", "send-email", "send_email/../wipe"].entries())
  await expectBlocked(`P-1${String(i).padStart(2, "0")}`, `name variant tool=${JSON.stringify(t)} (policy only allows exact send_email with allowed domain)`, mailer, { tool: t, action: "send", args: { to: "x@evil.com" } });
for (const [i, a] of ["Send", "send ", "*", "send​"].entries())
  await expectBlocked(`P-2${i}`, `action variant ${JSON.stringify(a)}`, mailer, { tool: "send_email", action: a, args: { to: "x@evil.com" } });

// --- argument smuggling against emailDomainIn
const evil = [
  ["list with evil second", ["a@example.com", "x@evil.com"]],
  ["comma list", "a@example.com, x@evil.com"],
  ["display name", "Evil <x@evil.com>"],
  ["trailing newline", "x@evil.com\n"],
  ["double at", "x@evil.com@example.com"],
  ["subdomain trick", "x@example.com.evil.com"],
  ["uppercase", "x@EVIL.com"],
  ["object where scalar belongs", { toString: "a@example.com", sha256: 5 }],
  ["nested", { a: "a@example.com" }],
  ["missing arg", undefined],
  ["null", null],
  ["number", 5],
  ["unicode domain", "x@exаmple.com"],
  ["null byte", "x@evil.com\u0000@example.com"],
  ["space", "x@evil.com @example.com"],
  ["empty list", []],
];
for (const [i, [n, v]] of evil.entries()) await expectBlocked(`P-3${String(i).padStart(2, "0")}`, `emailDomainIn bypass: ${n}`, mailer, { tool: "send_email", action: "send", args: v === undefined ? {} : { to: v } });
// duplicate keys / proto pollution / extra fields: send raw JSON
for (const [n, raw] of [
  ["duplicate key (last wins)", '{"tool":"send_email","action":"send","args":{"to":"x@evil.com","to":"a@example.com"}}'],
  ["duplicate key (first wins in other parsers)", '{"tool":"send_email","action":"send","args":{"to":"a@example.com","to":"x@evil.com"}}'],
  ["__proto__ in args", '{"tool":"send_email","action":"send","args":{"__proto__":{"to":"a@example.com"},"to":"x@evil.com"}}'],
  ["constructor/prototype", '{"tool":"send_email","action":"send","args":{"constructor":{"prototype":{"to":"a@example.com"}}}}'],
  ["unknown top-level field effect=allow", '{"tool":"send_email","action":"send","effect":"allow","args":{"to":"x@evil.com"}}'],
  ["unknown top-level agent id spoof", '{"tool":"send_email","action":"send","agentId":"other","args":{"to":"x@evil.com"}}'],
]) {
  const r = await call("POST", "/api/v1/authorize", { key: mailer.key, raw, headers: { "content-type": "application/json" } });
  record(`P-4${n.length % 10}${n.length}`, "policy-bypass", `raw JSON: ${n}`, authorized(r) ? "BROKEN" : "HELD", `${short(r)} ${r.text.slice(0, 140)}`);
}
// large / deep
const deep = (n) => { let o = { to: "x@evil.com" }; for (let i = 0; i < n; i++) o = { a: o }; return o; };
await expectBlocked("P-500", "deep nesting (20000 levels) does not crash or fail open", mailer, { tool: "send_email", action: "send", args: deep(20) });
const bigRaw = '{"tool":"send_email","action":"send","args":{"to":"x@evil.com","pad":"' + "A".repeat(70_000) + '"}}';
{ const r = await call("POST", "/api/v1/authorize", { key: mailer.key, raw: bigRaw, headers: { "content-type": "application/json" } }); record("P-501", "dos/policy", "70KB body refused", r.status === 413 ? "HELD" : "BROKEN", short(r)); }
{ const r = await call("POST", "/api/v1/authorize", { key: mailer.key, raw: '{"tool":"send_email","action":"send","args":' + "[".repeat(100000) + '}' , headers: { "content-type": "application/json" } }); record("P-502", "dos/policy", "100k-deep malformed JSON → clean 400, not 500/hang", r.status === 400 ? "HELD" : (r.status === 500 ? "BROKEN" : "HELD"), short(r)); }

// --- pathUnder
for (const [i, p] of ["/data/reports/../../etc/passwd", "/data/reports/%2e%2e/%2e%2e/etc/passwd", "/data/reports\\..\\..\\etc\\passwd", "/data/reportsX/secret", "/data/reports\u0000/../../etc/passwd", "/DATA/reports/x", "../data/reports/x", "/data/reports/./../x", "file:///etc/passwd", "/data//reports/../../etc", "data/reports/x", ["/data/reports/a", "/etc/passwd"], "/data/reports/..%2f..%2fetc", "/data/reports/‮", "~/../etc/passwd"].entries())
  await expectBlocked(`P-6${String(i).padStart(2, "0")}`, `pathUnder bypass ${JSON.stringify(p)}`, reader, { tool: "read_file", action: "read", args: { path: p } });
const okp = await ask(reader, { tool: "read_file", action: "read", args: { path: "/data/reports/q3.txt" } });
record("P-699", "sanity", "legit path allowed", authorized(okp) ? "HELD" : "BROKEN", short(okp));

// --- type confusion on a "approve when amount > 50" rule  (payer: refund allow, approve when amount gt 50)
for (const [i, [n, v]] of [["string number", "5000"], ["array", [5000]], ["nested obj", { v: 5000 }], ["bool", true], ["float string", "5e3"], ["null", null], ["missing", undefined], ["negative then abs", -5000], ["numeric text with space", " 5000"], ["huge", 1e308], ["NaN-ish string", "NaN"]].entries()) {
  const r = await ask(payer, { tool: "refund", action: "issue", args: v === undefined ? {} : { amount: v } });
  const allowed = authorized(r);
  record(`P-7${String(i).padStart(2, "0")}`, "type-confusion", `refund of 5000 expressed as amount=${n}: must need approval (rule: approve when amount>50)`, allowed ? "BROKEN" : "HELD", `${short(r)}  (status=${r.body?.status})`);
}
// numeric big sanity
{ const r = await ask(payer, { tool: "refund", action: "issue", args: { amount: 5000 } }); record("P-799", "sanity", "amount=5000 number needs approval", r.body?.status === "pending" ? "HELD" : "BROKEN", short(r)); }

// shell deny-when-contains
for (const [i, [n, c]] of [["plain", "rm -rf /"], ["case", "RM -RF /"], ["double space", "rm  -rf /"], ["tab", "rm\t-rf /"], ["split flags", "rm -r -f /"], ["rm -fr", "rm -fr /"], ["var", "r''m -rf /"], ["array arg", ["rm -rf /"]], ["number cmd", 5], ["object", { a: "rm -rf /" }], ["missing", undefined], ["unicode", "rm -rf /"], ["other key", "ignored"]].entries()) {
  const r = await ask(T.A.agents.reader, { tool: "shell", action: "run", args: c === undefined ? { cmd: "rm -rf /" } : (n === "other key" ? { cmd: "rm -rf /", command: "ls" } : { command: c }) });
  record(`P-8${String(i).padStart(2, "0")}`, "denylist-evasion", `shell deny when command contains 'rm -rf' — variant ${n}`, authorized(r) ? "SUSPECTED-WEAK(allowed)" : "HELD", `${short(r)}`);
}
