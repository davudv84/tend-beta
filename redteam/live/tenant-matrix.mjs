// Tenant isolation, exhaustively: two real accounts on a throwaway production build. Everything tenant A owns (agent, key, pending and approved
// authorizations, central policy, notification) is addressed by EVERY route, verb and identity of tenant B (operator cookie, agent key, anonymous).
// Nothing of A may come back (no id, no name, no email, no key), and A's objects must be unchanged afterwards.
import { readdirSync, readFileSync, statSync, mkdtempSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { startIsolatedServer } from "../../scripts/isolated-server.mjs";
import { record } from "./lib.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const dataDir = mkdtempSync(path.join(tmpdir(), "tend-matrix-"));
const ADMIN = `rt_admin_${randomBytes(24).toString("hex")}`;
const server = await startIsolatedServer({ root, env: { TEND_ADMIN_TOKEN: ADMIN, TEND_DATA_DIR: dataDir } });
const PW = "correct horse battery staple 42";
const api = async (m, p, { body, cookie, key, headers = {} } = {}) => { try { const r = await fetch(server.url + p, { method: m, redirect: "manual", headers: { ...(body !== undefined && { "content-type": "application/json" }), ...(cookie && { cookie }), ...(key && { authorization: `Bearer ${key}` }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000) }); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {} return { status: r.status, text, body: json, cookie: r.headers.get("set-cookie")?.split(";")[0] }; } catch (e) { return { status: 0, text: String(e), body: null }; } };
const mail = async (email) => { for (const end = Date.now() + 5000; Date.now() < end; await new Promise((r) => setTimeout(r, 150))) { try { const f = readdirSync(path.join(dataDir, "outbox")).filter((x) => x.includes(email)).sort().at(-1); if (f) return readFileSync(path.join(dataDir, "outbox", f), "utf8"); } catch {} } return ""; };
async function account(email) {
  await api("POST", "/api/account/register", { body: { email, password: PW } });
  const token = /#token=([A-Za-z0-9_-]{43})/.exec(await mail(email))?.[1];
  await api("POST", "/api/account/verify", { body: { token, password: PW } });
  const admin = (await api("POST", "/api/operator/session", { body: { token: ADMIN } })).cookie;
  const u = (await api("GET", "/api/admin/users", { cookie: admin })).body.users.find((x) => x.email === email);
  await api("POST", `/api/admin/users/${u.id}`, { cookie: admin, body: { action: "approve" } });
  return (await api("POST", "/api/account/sign-in", { body: { email, password: PW } })).cookie;
}
let failures = [];
try {
  const tag = randomBytes(4).toString("hex");
  const emailA = `owner-a-${tag}@example.com`, emailB = `owner-b-${tag}@example.com`;
  const A = await account(emailA), B = await account(emailB);
  const nameA = `AlphaSecretAgent${tag}`;
  const regA = (await api("POST", "/api/v1/agents", { cookie: A, body: { name: nameA, model: "m", provider: "Custom" } })).body;
  const regB = (await api("POST", "/api/v1/agents", { cookie: B, body: { name: `Bravo${tag}`, model: "m", provider: "Custom" } })).body;
  const rules = [{ tool: "wire", action: "send", effect: "approve" }, { tool: "read", action: "x", effect: "allow" }];
  await api("POST", `/api/v1/agents/${regA.agent.id}/policy`, { cookie: A, body: { rules, enforcement: "enforce" } });
  await api("POST", `/api/v1/agents/${regB.agent.id}/policy`, { cookie: B, body: { rules, enforcement: "enforce" } });
  const pend = (await api("POST", "/api/v1/authorizations", { key: regA.apiKey, body: { tool: "wire", action: "send", resource: "ACC-A1", detail: "A's private payment", args: { memo: `memo-${tag}` } } })).body;
  const appr = (await api("POST", "/api/v1/authorizations", { key: regA.apiKey, body: { tool: "wire", action: "send", resource: "ACC-A2" } })).body;
  await api("POST", `/api/v1/reviews/${appr.id}`, { cookie: A, body: { status: "approved" } });
  const cp = (await api("POST", "/api/v1/central-policies", { cookie: A, body: { name: `A-central-${tag}`, rules: [{ tool: "wire", action: "send", effect: "deny" }] } })).body?.centralPolicy;
  await api("POST", "/api/v1/notifications/test", { cookie: A, body: {} });
  const nots = (await api("GET", "/api/v1/notifications", { cookie: A })).body;
  const nid = nots?.notifications?.[0]?.id ?? "nt_none";
  const secrets = [regA.agent.id, pend.id, appr.id, cp.id, nameA, emailA, regA.apiKey.slice(0, 20), "A's private payment", `memo-${tag}`, "ACC-A1", "ACC-A2", nid];
  const ids = [regA.agent.id, pend.id, appr.id, cp.id, nid, "default"];

  const before = JSON.stringify({ pol: (await api("GET", `/api/v1/agents/${regA.agent.id}/policy`, { cookie: A })).body, st: (await api("GET", `/api/v1/authorizations/${pend.id}`, { key: regA.apiKey })).body?.status, cp: (await api("GET", "/api/v1/central-policies", { cookie: A })).body?.centralPolicies?.map((c) => [c.id, c.version]) });

  const walk = (d) => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const routes = walk(path.join(root, "src/app/api")).filter((f) => f.endsWith("route.ts")).map((f) => "/api/" + path.relative(path.join(root, "src/app/api"), path.dirname(f)).split(path.sep).join("/")).filter((r) => r !== "/api/" && !r.startsWith("/api/admin") && !r.startsWith("/api/account/") && !r.includes("operator/session") && !r.includes("health"));
  const adminCookie = (await api("POST", "/api/operator/session", { body: { token: ADMIN } })).cookie;
  // the platform admin signs in with the admin token: it works in the "default" workspace and approves accounts, it is not a key to every tenant
  const whos = { "B operator": { cookie: B }, "B agent key": { key: regB.apiKey }, "platform admin": { cookie: adminCookie }, anonymous: {} };
  const bodies = [{}, { status: "approved" }, { action: "resume" }, { rules: [{ tool: "wire", action: "send", effect: "allow" }], enforcement: "off" }, { assign: [regA.agent.id] }, { token: "tend_az_" + "A".repeat(43), tool: "wire", action: "send", resource: "ACC-A2" }, { name: "hijack" }];
  let n = 0;
  for (const route of routes) for (const id of route.includes("[id]") ? ids : [null]) for (const [wn, w] of Object.entries(whos)) for (const m of ["GET", "POST", "DELETE", "PUT", "PATCH"]) for (const b of m === "GET" || m === "DELETE" ? [undefined] : bodies) {
    const url = id ? route.replace("[id]", id) : route;
    const r = await api(m, url, { ...w, body: b }); n++;
    // An error that repeats the id the caller itself typed ("No agent with id …") is not a leak; anything else of A's is.
    const leak = secrets.find((s) => r.text.includes(s) && !(r.status >= 400 && url.includes(s)));
    if (leak && !(url.includes(regB.agent.id))) failures.push(`${wn} ${m} ${url}: response contains ${JSON.stringify(leak).slice(0, 40)}`);
    if (r.status >= 500 && !(r.status === 503 && url.includes("notifications/subscriptions"))) failures.push(`${wn} ${m} ${url}: ${r.status}`); // 503 there = browser push not configured on this server
    if (id && r.status >= 200 && r.status < 300 && !["GET"].includes(m) && wn !== "B agent key") failures.push(`${wn} ${m} ${url}: succeeded (${r.status}) on tenant A's object`);
    if (id && r.status >= 200 && r.status < 300 && wn === "B agent key" && /\/(token|spend|consume|cancel)$/.test(url)) failures.push(`${wn} ${m} ${url}: B's agent key worked on A's authorization`);
  }
  const users = await api("GET", "/api/admin/users", { cookie: adminCookie });
  if (/scrypt\$|password_hash|tend_sk_|tend_az_/.test(users.text)) failures.push("admin user list exposes a password hash, key or token");
  // listings of B must never contain anything of A
  for (const p of ["/api/v1/state", "/api/v1/events?since=0", "/api/v1/notifications", "/api/v1/central-policies", "/api/operator/sessions", "/api/v1/integrations/status"]) { const r = await api("GET", p, { cookie: B }); const leak = secrets.find((s) => r.text.includes(s)); if (leak) failures.push(`B GET ${p} lists ${JSON.stringify(leak).slice(0, 40)}`); }
  const after = JSON.stringify({ pol: (await api("GET", `/api/v1/agents/${regA.agent.id}/policy`, { cookie: A })).body, st: (await api("GET", `/api/v1/authorizations/${pend.id}`, { key: regA.apiKey })).body?.status, cp: (await api("GET", "/api/v1/central-policies", { cookie: A })).body?.centralPolicies?.map((c) => [c.id, c.version]) });
  if (before !== after) failures.push("tenant A's policy, pending authorization or central policy CHANGED during the attack");
  const still = await api("POST", `/api/v1/authorizations/${appr.id}/spend`, { key: regA.apiKey, body: { tool: "wire", action: "send", resource: "ACC-A2" } });
  if (still.status !== 200) failures.push(`A's own approved authorization no longer spends (${still.status}): the attack disturbed it`);
  record("TM-1", "tenancy", `tenant B (operator, agent key), the platform admin and anonymous × ${routes.length} routes × 5 verbs × tenant A's 5 object ids × bodies (${n} requests): no data of A returned, nothing of A changed, no 5xx`, failures.length ? "BROKEN" : "HELD", failures.slice(0, 10).join("\n"));
} finally { await server.stop(); }
