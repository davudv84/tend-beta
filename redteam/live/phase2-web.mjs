// Phase 2: web/platform checks over HTTP against the LOCAL instance.
import { readFileSync } from "node:fs";
import { BASE, call, record, short, makeAccount, PW, ADMIN_TOKEN } from "./lib.mjs";
const T = JSON.parse(readFileSync(new URL("./tenants.json", import.meta.url)));
const H = (c, id, a, t, e) => record(id, a, t, c ? "HELD" : "BROKEN", e);

// ---- headers
const page = await call("GET", "/");
const api = await call("GET", "/api/health");
const hs = (r, n) => r.headers.get(n);
record("W-01", "headers", "pages: CSP present", hs(page, "content-security-policy") || hs(page, "content-security-policy-report-only") ? "HELD" : "BROKEN", (hs(page, "content-security-policy") ?? hs(page, "content-security-policy-report-only") ?? "").slice(0, 400));
record("W-02", "headers", "pages: X-Frame-Options/nosniff/Referrer/Permissions/COOP", ["x-frame-options", "x-content-type-options", "referrer-policy", "permissions-policy", "cross-origin-opener-policy"].every((h) => hs(page, h)) ? "HELD" : "BROKEN", ["x-frame-options", "x-content-type-options", "referrer-policy", "permissions-policy", "cross-origin-opener-policy"].map((h) => `${h}=${hs(page, h)}`).join("; "));
record("W-03", "headers", "API responses: no-store + nosniff", hs(api, "cache-control") === "no-store" && hs(api, "x-content-type-options") === "nosniff" ? "HELD" : "BROKEN", `cache-control=${hs(api, "cache-control")}`);
record("W-04", "headers", "HSTS (dev server: only sent in production builds → not testable here)", "INFO", `strict-transport-security=${hs(page, "strict-transport-security")}`);
record("W-05", "headers", "no x-powered-by / server banner", hs(page, "x-powered-by") ? "BROKEN" : "HELD", `x-powered-by=${hs(page, "x-powered-by")}`);
// CORS
const pre = await call("OPTIONS", "/api/v1/authorize", { headers: { origin: "https://evil.example", "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" } });
const g = await call("GET", "/api/health", { headers: { origin: "https://evil.example" } });
record("W-06", "cors", "no permissive CORS (no ACAO on preflight or GET)", !hs(pre, "access-control-allow-origin") && !hs(g, "access-control-allow-origin") ? "HELD" : "BROKEN", `preflight=${pre.status} acao=${hs(pre, "access-control-allow-origin")}`);
// ---- cookie flags
const A = T.A;
const login = await call("POST", "/api/account/sign-in", { body: { email: A.email, password: "correct horse battery staple 42" } });
record("W-07", "cookie", "session cookie flags (HttpOnly, SameSite=Strict, Path=/; Secure/__Host only in prod)", /HttpOnly/i.test(login.setCookie ?? "") && /SameSite=Strict/i.test(login.setCookie ?? "") ? "HELD" : "BROKEN", (login.setCookie ?? "").replace(/=[^;]+/, "=<redacted>"));
// ---- unauthenticated pages for operator-only UI
for (const p of ["/home", "/sanctuary", "/account", "/connect", "/welcome"]) { const r = await call("GET", p); record(`W-1${p.length}`, "authn", `anonymous GET ${p} → redirect/401/200-shell without data`, [200, 302, 303, 307, 308, 401, 403].includes(r.status) ? "INFO" : "BROKEN", `${r.status} location=${r.headers.get("location")}`); }
// ---- source / debug exposure
for (const p of ["/.env", "/.env.local", "/.git/config", "/package.json", "/next.config.ts", "/src/server/db.ts", "/_next/static/chunks/main.js.map", "/api/debug", "/api/v1/debug", "/api/v1/gateway", "/api/health?verbose=1", "/redteam/live/tenants.json", "/prototype"]) {
  const r = await call("GET", p); const leaked = r.status === 200 && /TEND_ADMIN_TOKEN|DATABASE_URL|tend_sk_|\[core\]|import /.test(r.text.slice(0, 5000));
  H(!leaked, `W-2${p.length}`, "exposure", `GET ${p} leaks nothing sensitive`, `${r.status}`);
}
const health = await call("GET", "/api/health?x=1"); record("W-30", "info-leak", "/api/health discloses only ok/schema/storage", Object.keys(health.body ?? {}).sort().join() === "ok,schema,storage" ? "HELD" : "INFO", health.text);
// ---- rate limits / brute force / enumeration
const v = await makeAccount(`rt-victim-${Date.now().toString(36)}@example.com`);
const t0 = []; let blockedAt = null;
for (let i = 1; i <= 40; i++) { const r = await call("POST", "/api/account/sign-in", { body: { email: v.email, password: "wrong password number " + i } }); t0.push(r.status); if (r.status === 429 && !blockedAt) blockedAt = i; }
H(blockedAt !== null && blockedAt <= 25, "R-01", "brute-force", "account sign-in: password guessing is throttled", `first 429 at attempt ${blockedAt}; statuses=${[...new Set(t0)]}`);
const right = await call("POST", "/api/account/sign-in", { body: { email: v.email, password: PW } });
record("R-02", "dos/lockout", "after the flood, is the REAL owner locked out of their own account (attacker-triggered lockout)?", right.status === 200 ? "HELD" : "FINDING: victim locked out", `correct password → ${right.status} ${right.body?.error ?? ""}`);
const unk = await call("POST", "/api/account/sign-in", { body: { email: "nobody-" + Date.now() + "@example.com", password: "whatever long password" } });
record("R-03", "enumeration", "unknown email vs wrong password → same message", unk.body?.message === (await call("POST", "/api/account/sign-in", { body: { email: T.B.email, password: "wrong wrong wrong wrong" } })).body?.message ? "HELD" : "BROKEN", short(unk));
const f1 = await call("POST", "/api/account/forgot", { body: { email: T.A.email } }), f2 = await call("POST", "/api/account/forgot", { body: { email: "nobody-" + Date.now() + "@example.com" } });
H(f1.status === f2.status && JSON.stringify(f1.body) === JSON.stringify(f2.body), "R-04", "enumeration", "password-reset answer identical for known/unknown email", `${short(f1)} / ${short(f2)}`);
const reg1 = await call("POST", "/api/account/register", { body: { email: T.A.email, password: PW + "x" } }), reg2 = await call("POST", "/api/account/register", { body: { email: "fresh-" + Date.now() + "@example.com", password: PW } });
H(reg1.status === reg2.status && JSON.stringify(reg1.body) === JSON.stringify(reg2.body), "R-05", "enumeration", "register answer identical for existing/new email", `${short(reg1)} / ${short(reg2)}`);
// admin token guessing
const adm = []; let ab = null;
for (let i = 1; i <= 40; i++) { const r = await call("POST", "/api/operator/session", { body: { token: "guess-" + i + "-".padEnd(30, "x") } }); adm.push(r.status); if (r.status === 429 && !ab) ab = i; }
H(ab !== null && ab <= 25, "R-06", "brute-force", "admin-token guessing is throttled", `first 429 at ${ab}; statuses=${[...new Set(adm)]}`);
// does the throttle also lock out the real admin for a minute? (shared "unknown" client bucket, since no trusted proxy configured)
const real = await call("POST", "/api/operator/session", { body: { token: ADMIN_TOKEN } });
record("R-07", "dos/lockout", "legit admin sign-in right after an attacker's flood (same shared 'unknown' client bucket when TEND_TRUSTED_PROXY unset)", real.status === 200 || real.status === 201 ? "HELD" : "FINDING: admin locked out by attacker flood", `${real.status} ${real.body?.error ?? ""}`);
// agent key guessing throttle
const kf = []; for (let i = 0; i < 30; i++) kf.push((await call("GET", "/api/v1/agent/inbox", { key: "tend_sk_" + "Q".repeat(20) + String(i).padStart(12, "0") })).status);
H(kf.includes(429), "R-08", "brute-force", "agent-key guessing throttled", `statuses=${[...new Set(kf)]}`);
// weak passwords
const weak = await call("POST", "/api/account/register", { body: { email: "weak-" + Date.now() + "@example.com", password: "password1234" } });
record("R-09", "password-policy", "common password accepted?", weak.status === 202 ? "INFO: accepted (length-only policy, no breached-password check)" : "HELD", short(weak));
// open redirect / host header
const hh = await call("POST", "/api/account/forgot", { body: { email: T.A.email }, headers: { host: "evil.example", "x-forwarded-host": "evil.example" } });
record("R-10", "host-header", "reset-mail links built from request host locally (prod uses configured appUrl)", "INFO", `status=${hh.status}; see accounts.ts:73 — verify TEND_APP_URL set in production`);
