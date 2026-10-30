#!/usr/bin/env node
// The test inventory, read from the code rather than written by hand: every page, every API route with its methods and the guard it calls,
// every integration in the catalog, and the security mechanisms the server actually uses. Prints JSON (--json) or a summary.
//
//   node scripts/qa-inventory.mjs [--json]
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const app = path.join(root, "src/app");
const walk = (d) => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const urlOf = (file) => "/" + path.relative(app, path.dirname(file)).split(path.sep).filter((s) => !/^\(.*\)$/.test(s)).join("/");
const files = walk(app);

const pages = files.filter((f) => f.endsWith("page.tsx")).map((f) => urlOf(f).replace(/\/$/, "") || "/").sort();
const GUARDS = ["requireAdmin", "requireOperator", "requireSameSite", "authAgent", "currentSession", "viewerOf", "signIn", "passwordSignIn", "register", "verifyEmail", "requestReset", "resetPassword", "resendVerification"];
const routes = files.filter((f) => f.endsWith("route.ts")).map((f) => {
  const src = readFileSync(f, "utf8");
  const methods = [...src.matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
  const guards = GUARDS.filter((g) => src.includes(g));
  return { path: urlOf(f), methods, guards };
}).sort((a, b) => a.path.localeCompare(b.path));

const catalog = readFileSync(path.join(root, "src/lib/integrations-catalog.ts"), "utf8");
const integrations = [...catalog.matchAll(/^\s*\{\s*id: "([a-z0-9-]+)"/gm)].map((m) => m[1]);

const server = walk(path.join(root, "src/server")).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => readFileSync(f, "utf8")).join("\n");
const has = (re) => re.test(server);
const security = {
  "session cookie (__Host-, HttpOnly, SameSite=Strict, server-side rows)": has(/__Host-tend_operator/) && has(/SameSite=Strict/),
  "same-site check on operator routes": has(/function requireSameSite/),
  "scrypt password hashing": has(/scryptAsync/),
  "one-time hashed e-mail tokens": has(/function spendToken/),
  "per-address and per-account sign-in limits": has(/account:fail:/),
  "agent key hashing and per-agent rate limit": has(/keyfail:/) && has(/agentRequestsPerMinute/),
  "workspace ownership checks": has(/function agentInWorkspace/) && has(/function reviewInWorkspace/),
  "single-use authorizations bound to arguments": has(/already_consumed/),
  "hash-chained audit events": readFileSync(path.join(root, "src/server/db.ts"), "utf8").includes("events_chain"),
  "fail-closed policy evaluation (no rule = deny)": has(/no_policy/),
  "admin switch TEND_ADMIN=0": has(/adminDisabled/),
  "DB statement and idle timeouts": has(/statement_timeout/),
  "Content-Security-Policy with nonce": readFileSync(path.join(root, "src/proxy.ts"), "utf8").includes("newNonce"),
};
const inv = { pages, routes, integrations, security };
if (process.argv.includes("--json")) console.log(JSON.stringify(inv, null, 2));
else {
  console.log(`${pages.length} pages, ${routes.length} API routes (${routes.reduce((n, r) => n + r.methods.length, 0)} handlers), ${integrations.length} integrations, ${Object.keys(security).length} security mechanisms`);
  console.log("\nunguarded routes (no guard call in the file itself):");
  for (const r of routes.filter((r) => !r.guards.length)) console.log(`  ${r.methods.join(",").padEnd(16)} ${r.path}`);
  console.log("\nsecurity mechanisms not found in the code:", Object.entries(security).filter(([, v]) => !v).map(([k]) => k).join("; ") || "none");
}
