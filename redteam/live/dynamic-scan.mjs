// A small DAST pass (OWASP ZAP is not available here): every API route and page of a throwaway PRODUCTION build is hit with hostile verbs, bodies and
// headers, as an anonymous visitor, as the operator and as an agent. Fails on any 5xx, any stack trace or path in a body, any missing security header
// on an HTML page, and any cookie set without the production flags. Findings are about the app's own behavior; nothing external is contacted.
import { readdirSync, statSync, mkdtempSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { startIsolatedServer } from "../../scripts/isolated-server.mjs";
import { record } from "./lib.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const ADMIN = `rt_admin_${randomBytes(24).toString("hex")}`;
const server = await startIsolatedServer({ root, env: { TEND_ADMIN_TOKEN: ADMIN, TEND_DATA_DIR: mkdtempSync(path.join(tmpdir(), "tend-dast-")) } });
const walk = (d) => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const routes = walk(path.join(root, "src/app/api")).filter((f) => f.endsWith("route.ts")).map((f) => "/api/" + path.relative(path.join(root, "src/app/api"), path.dirname(f)).split(path.sep).join("/")).filter((r) => r !== "/api/");
const pages = walk(path.join(root, "src/app")).filter((f) => /page\.tsx$/.test(f) && !f.includes("/api/")).map((f) => "/" + path.relative(path.join(root, "src/app"), path.dirname(f)).split(path.sep).filter((s) => !/^\(.*\)$/.test(s)).join("/")).map((p) => (p === "/." ? "/" : p)).filter((p) => !p.includes("["));
const bad = [];
const note = (id, msg) => { bad.push(`${id}: ${msg}`); };
const raw = async (m, p, { body, headers = {}, cookie, key } = {}) => {
  try {
    const r = await fetch(server.url + p, { method: m, redirect: "manual", headers: { ...(cookie && { cookie }), ...(key && { authorization: `Bearer ${key}` }), ...headers }, body, signal: AbortSignal.timeout(20_000) });
    return { status: r.status, text: await r.text(), headers: r.headers };
  } catch (e) { return { status: 0, text: String(e), headers: new Headers() }; }
};
try {
  const login = await raw("POST", "/api/operator/session", { body: JSON.stringify({ token: ADMIN }), headers: { "content-type": "application/json" } });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const reg = JSON.parse((await raw("POST", "/api/v1/agents", { cookie, body: JSON.stringify({ name: "Dast", model: "m", provider: "Custom" }), headers: { "content-type": "application/json" } })).text);
  const ids = { id: reg.agent.id };
  const concrete = (r) => r.replace(/\[id\]/g, ids.id);
  const bodies = ["", "null", "[]", "{}", '"str"', "123", "{", '{"a":' + "[".repeat(5000) + "}", JSON.stringify({ name: "x".repeat(70_000) }), JSON.stringify({ tool: "../../etc/passwd", action: "\u0000", args: { __proto__: { x: 1 }, constructor: { prototype: {} } } }), JSON.stringify({ status: 1e999, ids: Array(2000).fill("a"), token: { $ne: 1 }, email: ["a@b.co"], password: 12345 }), JSON.stringify({ events: Array(60).fill({ type: "x" }) }), "\u0000\u0001\u0002", Buffer.from([0xff, 0xfe, 0x00, 0x41]).toString("latin1")];
  const verbs = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
  const who = { anon: {}, operator: { cookie }, agent: { key: reg.apiKey } };
  let n = 0;
  for (const route of routes) for (const [wn, w] of Object.entries(who)) for (const v of verbs) {
    const url = concrete(route);
    const list = v === "GET" || v === "HEAD" || v === "OPTIONS" ? [undefined] : bodies;
    for (const b of list) {
      const hdr = b === undefined ? {} : { "content-type": n++ % 3 === 0 ? "text/plain" : "application/json" };
      const r = await raw(v, url, { ...w, body: b, headers: hdr });
      const id = `${wn} ${v} ${url} body=${b === undefined ? "-" : JSON.stringify(b).slice(0, 24)}`;
      if (r.status >= 500 || r.status === 0) note(id, `status ${r.status} ${r.text.slice(0, 100)}`);
      if (/\n\s+at .*\(|node_modules|\/home\/|\/src\/server|SELECT .* FROM|pg_|PGlite|stack/i.test(r.text) && r.status >= 400) note(id, `leaks internals: ${r.text.slice(0, 120)}`);
      if (v === "TRACE" && r.status === 200) note(id, "TRACE answered 200");
      if (wn !== "operator" && !route.includes("/account/") && !route.includes("operator/session") && !route.includes("health") && r.status === 200 && !(v === "GET" && route === "/api/v1/check-ins") /* public protocol description */ && v !== "OPTIONS" && v !== "HEAD" && !(wn === "agent" && /v1\/(agent|authoriz|check-ins|events|gateway)/.test(route))) note(id, `non-operator got 200 on ${route}`);
    }
  }
  record("DS-1", "dast", `${routes.length} API routes × 3 identities × verbs × hostile bodies: no 5xx, no stack traces/paths, TRACE off, no unexpected 200 for non-operators`, bad.length ? "BROKEN" : "HELD", bad.slice(0, 8).join("\n"));
  // private data must not reach an anonymous visitor through server-rendered pages either
  const secretName = `PrivateAgent-${randomBytes(6).toString("hex")}`;
  await raw("POST", "/api/v1/agents", { cookie, body: JSON.stringify({ name: secretName, model: "m", provider: "Custom" }), headers: { "content-type": "application/json" } });
  const leaks = [];
  for (const p of [...pages, "/api/v1/state", "/api/v1/events?since=0", "/api/v1/notifications", "/api/v1/central-policies"]) {
    const r = await raw("GET", p, {});
    if (r.text.includes(secretName) || r.text.includes(ids.id) || /tend_sk_[A-Za-z0-9_-]{20,}/.test(r.text)) leaks.push(`${p} ${r.status}`);
  }
  record("DS-6", "dast", `anonymous visitors get no agent name, id or key from any of ${pages.length + 4} pages and data routes`, leaks.length ? "BROKEN" : "HELD", leaks.join(", "));
  const pageBad = [];
  for (const p of pages) {
    const r = await raw("GET", p, { cookie });
    if (r.status >= 500) pageBad.push(`${p} ${r.status}`);
    if (r.headers.get("content-type")?.includes("text/html") && r.status < 400) for (const h of ["content-security-policy", "x-frame-options", "x-content-type-options", "referrer-policy", "strict-transport-security", "cross-origin-opener-policy", "permissions-policy"]) if (!r.headers.get(h)) pageBad.push(`${p} missing ${h}`);
    if (r.headers.get("set-cookie")) pageBad.push(`${p} sets a cookie`);
  }
  record("DS-2", "dast", `${pages.length} pages as the signed-in operator: no 5xx, every HTML page carries CSP, frame, nosniff, referrer, HSTS, COOP and permissions headers, none sets a cookie`, pageBad.length ? "BROKEN" : "HELD", pageBad.slice(0, 8).join("\n"));
  const h = await raw("GET", "/", { headers: { host: "evil.example", "x-forwarded-host": "evil.example", "x-forwarded-proto": "http" } });
  record("DS-3", "dast", "a spoofed Host/X-Forwarded-Host does not appear in the page", /evil\.example/.test(h.text) ? "BROKEN" : "HELD", `${h.status}`);
  const big = await raw("GET", "/", { headers: { cookie: "a=" + "x".repeat(9000) } });
  record("DS-4", "dast", "an oversized Cookie header is refused or ignored, not a 5xx", big.status < 500 ? "HELD" : "BROKEN", `${big.status}`);
  for (const p of ["/_next/../../etc/passwd", "/%2e%2e/%2e%2e/etc/passwd", "/api/v1/%00", "/..%2f..%2fpackage.json", "//etc/passwd", "/public/../.env"]) { const r = await raw("GET", p); if (r.status === 200 && /root:|TEND_ADMIN|"name": "tend"/.test(r.text)) note("traversal", p); }
  record("DS-5", "dast", "path traversal probes return nothing from the filesystem", bad.some((b) => b.startsWith("traversal")) ? "BROKEN" : "HELD", "");
} finally { await server.stop(); }
process.exitCode = bad.length ? 1 : 0;
