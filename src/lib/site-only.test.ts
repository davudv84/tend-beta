// Site-only showcase (TEND_SITE_ONLY=1): only the marketing pages and their files are served; the app, every API route and the database are
// out of reach, at every layer. src/lib/site-only.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server.js";
import { proxy } from "../proxy.ts";
import { sitePathAllowed } from "./site-only.ts";
import { getDb } from "../server/db.ts";
import { route, json } from "../server/http.ts";
import { checkSiteOnly, checkTargets } from "../server/deploy-check.mjs";

async function withEnv(env: Record<string, string | undefined>, fn: () => Promise<void> | void) {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  (globalThis as { __tendDb?: unknown }).__tendDb = undefined;
  try { await fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } (globalThis as { __tendDb?: unknown }).__tendDb = undefined; }
}

const PUBLIC = ["/", "/about", "/changelog", "/compare", "/compare/claude-code", "/contact", "/docs", "/how-it-works", "/imprint", "/privacy", "/product",
  "/product/approvals", "/security", "/terms", "/threat-model", "/verification-report", "/robots.txt", "/sitemap.xml", "/opengraph-image",
  "/opengraph-image?x", "/icon.svg", "/home/hero-1280.avif", "/screens/approvals/desktop.webp", "/art/valley.jpg", "/demo/tend-demo.mp4"].map((p) => p.split("?")[0]);
const PRIVATE = ["/home", "/agents", "/oversight", "/timeline", "/policies", "/connect", "/verification", "/settings", "/operator", "/admin", "/admin/users",
  "/integrations", "/developers", "/labs", "/sanctuary", "/check-ins", "/research", "/reflections", "/account/sign-in", "/account/sign-up", "/welcome",
  "/prototype", "/design-system", "/api", "/api/health", "/api/v1/state", "/api/operator/session", "/api/admin/users", "/api/v1/authorize",
  "/sw.js", "/sdk/tend-sdk.tgz", "/home/../api/health", "/compare/../api/v1/state", "/product/x/y", "/home/x.html", "/screens//x.webp",
  "/compare/../../home"];

test("SITE-1 only the marketing pages and their images are allowed; the app, the API, the SDK and traversal tricks are not", () => {
  for (const p of PUBLIC) assert.equal(sitePathAllowed(p), true, p);
  for (const p of PRIVATE) assert.equal(sitePathAllowed(p), false, p);
});

test("SITE-2 the proxy answers 404 for everything else in site-only mode, and changes nothing without it", async () => {
  await withEnv({ TEND_SITE_ONLY: "1" }, () => {
    for (const p of ["/operator", "/account/sign-in", "/account/sign-up"]) {
      const r = proxy(new NextRequest(`http://localhost${p}?next=/admin`));
      assert.equal(r.status, 307, p); assert.equal(r.headers.get("location"), "http://localhost/contact", `${p}: to the contact page, nothing carried over`);
    }
    for (const p of ["/home", "/api/health", "/api/v1/state", "/admin/users", "/account/forgot", "/account/verify"]) {
      const r = proxy(new NextRequest(`http://localhost${p}`));
      assert.equal(r.status, 404, p);
      assert.equal(r.headers.get("x-robots-tag"), "noindex");
    }
    const home = proxy(new NextRequest("http://localhost/"));
    assert.notEqual(home.status, 404);
    assert.match(home.headers.get("content-security-policy") ?? "", /script-src 'self' 'nonce-/, "the public pages keep their CSP");
  });
  await withEnv({ TEND_SITE_ONLY: undefined }, () => {
    assert.notEqual(proxy(new NextRequest("http://localhost/home")).status, 404);
    assert.notEqual(proxy(new NextRequest("http://localhost/api/health")).status, 404);
  });
});

test("SITE-3 the server never connects in site-only mode, even with a database URL present, and every API route answers 404 first", async () => {
  // Port 1: if anything tried to connect, the error would be ECONNREFUSED, not the 404 below.
  await withEnv({ TEND_SITE_ONLY: "1", DATABASE_URL: "postgres://x:y@127.0.0.1:1/none", DATABASE_MIGRATE_URL: undefined, VERCEL: undefined }, async () => {
    const e = await getDb().then(() => undefined, (x: Error & { status?: number; code?: string }) => x);
    assert.equal(e?.status, 404); assert.equal(e?.code, "not_found");
    let ran = false;
    const handler = route(async () => { ran = true; return json({ secret: "never" }); });
    const r = await handler(new Request("http://localhost/api/v1/state"), {});
    assert.equal(r.status, 404); assert.equal(ran, false, "the route's own code did not run");
    assert.deepEqual(await r.json(), { error: "not_found", message: "Not available on this site." });
  });
});

test("SITE-4 the build refuses a site-only deployment that carries any database variable, connection-like value or TEND secret; names only", () => {
  const base = { VERCEL: "1", VERCEL_ENV: "production", TEND_SITE_ONLY: "1", NEXT_TELEMETRY_DISABLED: "1" };
  const clean = checkTargets(base);
  assert.equal((clean as { siteOnly?: boolean }).siteOnly, true); assert.deepEqual(clean.problems, []);
  assert.ok(clean.facts.some((f) => /database variables none, TEND secrets none, connection-like values none/.test(f)), clean.facts.join(" | "));
  const secret = "s3cr3t-value-never-printed";
  for (const [k, v] of [["DATABASE_URL", "postgresql://u:p@ep-x.aws.neon.tech/db"], ["POSTGRES_PRISMA_URL", "x"], ["PGHOST", "ep-x.aws.neon.tech"], ["DATABASE_MIGRATE_URL", "x"],
    ["TEND_ADMIN_TOKEN", secret], ["TEND_CONTEXT_KEY", secret], ["TEND_MFA_KEY", secret], ["RESEND_API_KEY", secret], ["TEND_EXPECT_DB", "tend"]]) {
    const r = checkTargets({ ...base, [k]: v });
    assert.ok(r.problems.some((p) => p.startsWith(`${k} is set`)), `${k}: ${r.problems.join(" | ")}`);
    assert.ok(!r.problems.join(" ").includes(secret) && !r.problems.join(" ").includes("neon.tech"), "no value printed");
  }
  const hidden = checkSiteOnly({ ...base, SOME_OTHER_NAME: "postgres://u:p@db.example.com/x" });
  assert.ok(hidden.problems.some((p) => /^SOME_OTHER_NAME holds something that looks like a database connection/.test(p)));
  // not site-only: the database rules apply as before (no targets → blocked)
  assert.ok(checkTargets({ ...base, TEND_SITE_ONLY: undefined }).problems.some((p) => /TEND_EXPECT_DB must be set/.test(p)));
});
