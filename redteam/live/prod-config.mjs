// Production-mode checks against a throwaway production build: HSTS, __Host- Secure cookie, weak admin token refusal, accounts/public defaults.
import { mkdtempSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { startIsolatedServer } from "../../scripts/isolated-server.mjs";
import { record } from "./lib.mjs";
const root = path.resolve(import.meta.dirname, "../..");
const ADMIN = `rt_admin_${randomBytes(24).toString("hex")}`;
const dir = () => mkdtempSync(path.join(tmpdir(), "tend-prodcfg-"));
const H = (c, id, t, e) => record(id, "production", t, c ? "HELD" : "BROKEN", e);

// A: production defaults as a real deployment sees them (no TEND_LOCAL_HTTP): the strict cookie and HSTS
let s = await startIsolatedServer({ root, env: { TEND_ADMIN_TOKEN: ADMIN, TEND_DATA_DIR: dir(), TEND_LOCAL_HTTP: "0" } });
try {
  const page = await fetch(s.url + "/"); const hsts = page.headers.get("strict-transport-security");
  H(/max-age=\d{7,}/.test(hsts ?? "") && /includeSubDomains/.test(hsts ?? ""), "PC-1", "HSTS sent by the production build (≥ 1 year, includeSubDomains)", hsts);
  const csp = page.headers.get("content-security-policy") ?? "";
  H(!/unsafe-eval/.test(csp) && !/script-src[^;]*unsafe-inline/.test(csp) && /frame-ancestors 'none'/.test(csp), "PC-2", "production CSP has no unsafe-eval / script unsafe-inline and forbids framing", csp.slice(0, 200));
  const login = await fetch(s.url + "/api/operator/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: ADMIN }) });
  const sc = login.headers.get("set-cookie") ?? "";
  H(/^__Host-tend_operator=/.test(sc) && /;\s*Secure/i.test(sc) && /HttpOnly/i.test(sc) && /SameSite=Strict/i.test(sc) && /Path=\//.test(sc) && !/Domain=/i.test(sc), "PC-3", "production session cookie: __Host- prefix, Secure, HttpOnly, SameSite=Strict, Path=/, no Domain", sc.replace(/=[^;]+/, "=<redacted>"));
  const reg = await fetch(s.url + "/api/account/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "x@example.com", password: "correct horse battery staple" }) });
  H([404, 403, 503].includes(reg.status), "PC-4", "accounts are OFF in production until RESEND_API_KEY, TEND_EMAIL_FROM and TEND_APP_URL are set (no mail → no sign-up)", `register → ${reg.status}`);
  const api = await fetch(s.url + "/api/v1/state"); H(api.status === 401, "PC-5", "anonymous visitors get nothing when an admin token is set", `state → ${api.status}`);
  const x = await fetch(s.url + "/api/v1/state", { headers: { "x-forwarded-for": "1.2.3.4" } }); H(x.status === 401, "PC-6", "forwarded headers change nothing without TEND_TRUSTED_PROXY", `${x.status}`);
  const err = await fetch(s.url + "/api/v1/agents", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{" });
  H(!/at .*\.(ts|js)|node_modules|stack/i.test(await err.text()), "PC-7", "error bodies carry no stack traces or paths", `${err.status}`);
} finally { await s.stop(); }

// B: a weak admin token must disable operator sign-in in production (not silently accept)
s = await startIsolatedServer({ root, env: { TEND_ADMIN_TOKEN: "password1234password1234password", TEND_DATA_DIR: dir(), TEND_LOCAL_HTTP: "0", TEND_PUBLIC: "" } });
try {
  const r = await fetch(s.url + "/api/operator/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "password1234password1234password" }) });
  H(r.status === 403, "PC-8", "a weak TEND_ADMIN_TOKEN (low variety / repeated) is refused in production: nobody can sign in", `sign-in → ${r.status}`);
  const st = await fetch(s.url + "/api/v1/state"); H(st.status === 401, "PC-9", "with NO usable admin token and TEND_PUBLIC unset a production build stays LOCKED (never public by default)", `state → ${st.status}`);
} finally { await s.stop(); }
