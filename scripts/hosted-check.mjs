#!/usr/bin/env node
// Checks a hosted TEND from outside, without any secret: what a stranger, a scanner or an attacker meets. Read-only except one optional
// sign-up with Resend's test recipient (--mail), which creates one unconfirmed account and sends one mail Resend discards.
//
//   node scripts/hosted-check.mjs https://tend-beta-mauve.vercel.app [--mail]
const base = (process.argv[2] ?? "").replace(/\/$/, "");
if (!/^https:\/\//.test(base)) { console.error("Usage: node scripts/hosted-check.mjs https://your-tend [--mail]"); process.exit(2); }
let passed = 0, failed = 0;
const check = (ok, text) => { if (ok) passed++; else failed++; console.log(`${ok ? "ok  " : "FAIL"} ${text}`); };
const get = (p, o = {}) => fetch(base + p, { redirect: "manual", ...o });
const post = (p, body, headers = {}) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

const health = await (await get("/api/health")).json();
check(health.ok && health.storage === "postgres" && health.schema >= 11, `health: ${JSON.stringify(health)}`);
const viewer = (await (await get("/api/operator/session")).json()).viewer;
const adminOff = viewer.approval === false; // TEND_ADMIN=0: no admin sign-in, no approval step
check(viewer.public === false && viewer.demo === false && viewer.accounts === true && viewer.operatorAvailable === !adminOff, `private, no demo, accounts on, admin ${adminOff ? "turned off" : "sign-in available"}: ${JSON.stringify(viewer)}`);

const home = await get("/");
const h = home.headers;
check((h.get("strict-transport-security") ?? "").includes("max-age"), "HSTS header");
check(/default-src|script-src/.test(h.get("content-security-policy") ?? ""), "Content-Security-Policy header");
check((h.get("x-content-type-options") ?? "") === "nosniff" && /DENY|SAMEORIGIN/i.test(h.get("x-frame-options") ?? "") || /frame-ancestors/.test(h.get("content-security-policy") ?? ""), "no sniffing, no framing");
check(!h.get("x-powered-by"), "no X-Powered-By");

for (const p of ["/api/v1/state", "/api/v1/events?since=0", "/api/v1/central-policies", "/api/admin/users", "/api/admin/audit"]) {
  const r = await get(p);
  check([401, 403].includes(r.status), `signed out, ${p} is refused (${r.status})`);
}
for (const [p, body] of [["/api/v1/authorize", { tool: "t", action: "call" }], ["/api/v1/authorizations", { tool: "t", action: "call" }], ["/api/v1/events", { type: "tool.called", data: {} }]]) {
  const none = await post(p, body), bad = await post(p, body, { authorization: `Bearer tend_sk_${"x".repeat(32)}` });
  check(none.status === 401 && bad.status === 401, `${p} without a key and with a made-up key: 401 / 401 (${none.status} / ${bad.status})`);
}
const cross = await post("/api/account/sign-in", { email: "a@example.com", password: "whatever-long" }, { origin: "https://evil.example", "sec-fetch-site": "cross-site" });
check(cross.status === 403, `a cross-site sign-in is refused (${cross.status})`);
const admin = await post("/api/operator/session", { token: "not-the-admin-token-not-the-admin-token" });
check(admin.status === (adminOff ? 404 : 401) && !admin.headers.get("set-cookie"), `a wrong admin token: ${adminOff ? 404 : 401}, no cookie (${admin.status})`);
if (adminOff) for (const p of ["/operator", "/admin/users"]) check((await get(p)).status === 404, `${p} is not found while the admin is off`);
const wrong = await (await post("/api/account/sign-in", { email: "nobody-here@example.com", password: "wrong password here" })).json();
check(wrong.error === "invalid_credentials", `sign-in with an unknown address: invalid_credentials (${wrong.error})`);
const forgot1 = await post("/api/account/forgot", { email: "nobody-here@example.com" }), forgot2 = await post("/api/account/forgot", { email: "also-nobody@example.com" });
check(forgot1.status === 202 && JSON.stringify(await forgot1.json()) === JSON.stringify(await forgot2.json()), "forgot password: the same answer for any address");

for (const f of ["tend.mjs", "tend_gate.py", "sample.mjs"]) {
  const r = await get(`/sdk/${f}`);
  const text = await r.text();
  check(r.ok && !/tend_sk_[A-Za-z0-9_-]{20}|sk-ant-|re_[A-Za-z0-9]{20}/.test(text), `/sdk/${f} is served (${r.status}, ${text.length} bytes) and holds no key`);
}
for (const p of ["/account/sign-in", "/account/sign-up", "/integrations"]) check((await get(p)).status === 200, `${p} loads`);
for (const p of ["/.env", "/.env.local", "/beta-envs/tend-beta/vercel.env", "/.git/config", "/package.json"]) check((await get(p)).status === 404, `${p} is not served`);

if (process.argv.includes("--mail")) {
  // Resend's documented test recipient: the mail is accepted and discarded. Whether TEND could send is in the server log ("could not send mail").
  const r = await post("/api/account/register", { email: "delivered@resend.dev", password: "hosted check passphrase" });
  check(r.status === 202, `sign-up with Resend's test recipient is accepted (${r.status}); look for "could not send mail" in the runtime log`);
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
