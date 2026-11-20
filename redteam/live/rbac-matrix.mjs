#!/usr/bin/env node
// Workspace roles over HTTP, against a production build (with TEND_E2E_DATABASE_URL: PostgreSQL, row-level security, restricted login, signed
// context). One workspace with an owner, an admin, an operator and a viewer (invited through the API, accepted through the mailed link), and a
// second workspace. Each role tries real actions; the answer and the effect are checked. Prints HELD/BROKEN lines like the other live suites.
import { readdirSync, readFileSync, mkdtempSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { startIsolatedServer } from "../../scripts/isolated-server.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const dataDir = mkdtempSync(path.join(tmpdir(), "tend-rbac-"));
const ADMIN = `rt_admin_${randomBytes(24).toString("hex")}`;
const server = await startIsolatedServer({ root, env: { TEND_ADMIN_TOKEN: ADMIN, TEND_DATA_DIR: dataDir } });
const PW = "correct horse battery staple 42";
const api = async (m, p, { body, cookie, key } = {}) => {
  const r = await fetch(server.url + p, { method: m, redirect: "manual", headers: { ...(body !== undefined && { "content-type": "application/json" }), ...(cookie && { cookie }), ...(key && { authorization: `Bearer ${key}` }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, text, body: json, cookie: r.headers.get("set-cookie")?.split(";")[0] };
};
const mail = async (email) => { for (const end = Date.now() + 20_000; Date.now() < end; await new Promise((r) => setTimeout(r, 150))) { try { const f = readdirSync(path.join(dataDir, "outbox")).filter((x) => x.includes(email)).sort().at(-1); if (f) return readFileSync(path.join(dataDir, "outbox", f), "utf8"); } catch {} } return ""; };
const tokenIn = (t) => /#token=([A-Za-z0-9_-]{43})/.exec(t)?.[1];
let held = 0, broken = 0;
const H = (ok, id, title, ev = "") => { ok ? held++ : broken++; console.log(`[${ok ? "HELD  " : "BROKEN"}] ${id} ${title}${ok ? "" : `  (${ev})`}`); };
const s = (r) => `${r.status} ${r.body?.error ?? ""}`.trim();

async function founder(email) {
  await api("POST", "/api/account/register", { body: { email, password: PW } });
  await api("POST", "/api/account/verify", { body: { token: tokenIn(await mail(email)), password: PW } });
  const admin = (await api("POST", "/api/operator/session", { body: { token: ADMIN } })).cookie;
  const u = (await api("GET", "/api/admin/users", { cookie: admin })).body.users.find((x) => x.email === email);
  await api("POST", `/api/admin/users/${u.id}`, { cookie: admin, body: { action: "approve" } });
  return (await api("POST", "/api/account/sign-in", { body: { email, password: PW } })).cookie;
}
async function invite(by, email, role) {
  const r = await api("POST", "/api/v1/members", { cookie: by, body: { email, role } });
  if (r.status !== 202) throw new Error(`invite ${role}: ${r.text}`);
  const t = tokenIn(await mail(email));
  const a = await api("POST", "/api/account/invitation", { body: { token: t, password: PW } });
  if (a.status !== 200) throw new Error(`accept ${role}: ${a.text}`);
  const cookie = (await api("POST", "/api/account/sign-in", { body: { email, password: PW } })).cookie;
  const id = (await api("GET", "/api/v1/members", { cookie })).body.members.find((m) => m.email === email).id;
  return { id, cookie };
}

try {
  const tag = randomBytes(4).toString("hex");
  const owner = await founder(`owner-${tag}@example.com`);
  const admin = await invite(owner, `admin-${tag}@example.com`, "admin");
  const op = await invite(owner, `op-${tag}@example.com`, "operator");
  const viewer = await invite(owner, `viewer-${tag}@example.com`, "viewer");
  const other = await founder(`other-${tag}@example.com`);
  const roles = { viewer: viewer.cookie, operator: op.cookie, admin: admin.cookie, owner };
  const members = (await api("GET", "/api/v1/members", { cookie: owner })).body.members;
  H(members.length === 4 && members.every((m) => m.status === "active"), "RB-01", "invitations accepted through the mailed link: 4 active members in one workspace", JSON.stringify(members));

  // manage (admin and up): register an agent
  for (const [role, cookie] of Object.entries(roles)) {
    const r = await api("POST", "/api/v1/agents", { cookie, body: { name: `a-${role}-${tag}`, model: "m", provider: "Custom" } });
    H(["admin", "owner"].includes(role) ? r.status === 201 : r.status === 403 && r.body?.error === "forbidden_role", "RB-02", `${role}: register an agent ${["admin", "owner"].includes(role) ? "allowed" : "refused"}`, s(r));
  }
  const reg = (await api("POST", "/api/v1/agents", { cookie: owner, body: { name: `main-${tag}`, model: "m", provider: "Custom" } })).body;
  for (const [role, cookie] of Object.entries(roles)) {
    const r = await api("POST", `/api/v1/agents/${reg.agent.id}/policy`, { cookie, body: { rules: [{ tool: "wire", action: "send", effect: "approve" }], enforcement: "enforce" } });
    H(["admin", "owner"].includes(role) ? r.status < 300 : r.status === 403, "RB-03", `${role}: change an agent's rules ${["admin", "owner"].includes(role) ? "allowed" : "refused"}`, s(r));
    const k = await api("DELETE", `/api/v1/agents/${reg.agent.id}/keys`, { cookie: role === "admin" || role === "owner" ? "x=y" : cookie });
    if (role === "viewer" || role === "operator") H(k.status === 403 || k.status === 401, "RB-04", `${role}: revoke an agent key refused`, s(k));
  }
  const key = (await api("POST", `/api/v1/agents/${reg.agent.id}/keys`, { cookie: admin.cookie })).body?.apiKey;
  H(typeof key === "string", "RB-05", "admin: rotate an agent key allowed");
  // operate (operator and up): decide an approval
  for (const [role, cookie] of Object.entries(roles)) {
    const a = (await api("POST", "/api/v1/authorizations", { key, body: { tool: "wire", action: "send", resource: `ACC-${role}` } })).body;
    const r = await api("POST", `/api/v1/reviews/${a.id}`, { cookie, body: { status: "rejected" } });
    H(role === "viewer" ? r.status === 403 : r.status < 300, "RB-06", `${role}: decide an approval ${role === "viewer" ? "refused" : "allowed"}`, s(r));
    const st = (await api("GET", `/api/v1/authorizations/${a.id}`, { key })).body?.status;
    H(role === "viewer" ? st === "pending" : st === "rejected", "RB-07", `${role}: the approval's state matches (${role === "viewer" ? "still pending" : "rejected"})`, st);
  }
  // view: every role reads the workspace
  for (const [role, cookie] of Object.entries(roles)) { const r = await api("GET", "/api/v1/central-policies", { cookie }); H(r.status === 200, "RB-08", `${role}: read central policies`, s(r)); }
  // members: escalation
  H((await api("POST", "/api/v1/members", { cookie: op.cookie, body: { email: `x1-${tag}@example.com`, role: "viewer" } })).status === 403, "RB-09", "operator cannot invite");
  H((await api("POST", "/api/v1/members", { cookie: admin.cookie, body: { email: `x2-${tag}@example.com`, role: "owner" } })).status === 403, "RB-10", "admin cannot invite an owner");
  const exists = await api("POST", "/api/v1/members", { cookie: owner, body: { email: `other-${tag}@example.com`, role: "viewer" } });
  const fresh = await api("POST", "/api/v1/members", { cookie: owner, body: { email: `nobody-${tag}@example.com`, role: "viewer" } });
  H(exists.status === 202 && fresh.status === 202 && exists.body?.invitation?.status === fresh.body?.invitation?.status, "RB-19", "inviting an address that has an account answers exactly like a new one (no enumeration)", `${exists.status}/${fresh.status}`);
  const t2 = tokenIn(await mail(`other-${tag}@example.com`));
  H((await api("POST", "/api/account/invitation", { body: { token: t2, password: PW } })).status === 400, "RB-20", "an existing account cannot accept an invitation (accounts never move between workspaces)");
  const ownerId = members.find((m) => m.role === "owner").id;
  H((await api("PATCH", `/api/v1/members/${ownerId}`, { cookie: admin.cookie, body: { role: "viewer" } })).status === 403, "RB-11", "admin cannot demote the owner");
  H((await api("PATCH", `/api/v1/members/${admin.id}`, { cookie: admin.cookie, body: { role: "owner" } })).status === 403, "RB-12", "admin cannot promote themselves");
  H((await api("PATCH", `/api/v1/members/${op.id}`, { cookie: other, body: { role: "viewer" } })).status === 404, "RB-13", "another workspace's owner gets 404 for this workspace's member");
  H((await api("DELETE", `/api/v1/members/${viewer.id}`, { cookie: other })).status === 404, "RB-14", "another workspace's owner cannot remove a member here");
  // changes apply on the next request
  await api("PATCH", `/api/v1/members/${op.id}`, { cookie: owner, body: { role: "viewer" } });
  const a2 = (await api("POST", "/api/v1/authorizations", { key, body: { tool: "wire", action: "send", resource: "ACC-demoted" } })).body;
  H((await api("POST", `/api/v1/reviews/${a2.id}`, { cookie: op.cookie, body: { status: "approved" } })).status === 403, "RB-15", "demoted operator→viewer: the next decision is refused");
  await api("DELETE", `/api/v1/members/${viewer.id}`, { cookie: owner });
  H((await api("GET", "/api/v1/members", { cookie: viewer.cookie })).status === 403, "RB-16", "removed member: the session stops at once");
  H((await api("POST", "/api/account/sign-in", { body: { email: `viewer-${tag}@example.com`, password: PW } })).status >= 400, "RB-17", "removed member cannot sign in again");
  // two owners demoting each other at the same moment (real concurrency on PostgreSQL): one wins, one owner remains
  const owner2 = await invite(owner, `owner2-${tag}@example.com`, "owner");
  const [r1, r2] = await Promise.all([api("PATCH", `/api/v1/members/${owner2.id}`, { cookie: owner, body: { role: "admin" } }), api("PATCH", `/api/v1/members/${ownerId}`, { cookie: owner2.cookie, body: { role: "admin" } })]);
  const owners = (await api("GET", "/api/v1/members", { cookie: owner })).body?.members?.filter((m) => m.role === "owner" && m.status === "active") ?? [];
  H([r1.status, r2.status].filter((x) => x === 200).length === 1 && owners.length === 1, "RB-18", "concurrent mutual demotion of two owners: exactly one succeeds, one owner remains", `${s(r1)} / ${s(r2)} owners=${owners.length}`);
} catch (e) { broken++; console.log(`[BROKEN] RB-XX harness error: ${e.message}`); }
finally { await server.stop(); }
console.log(`\nHELD=${held} BROKEN=${broken}`);
process.exit(broken ? 1 : 0);
