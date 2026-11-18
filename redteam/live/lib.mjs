// Shared helpers for the live red-team harness. LOCAL instance only: refuses anything but loopback.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const BASE = process.env.RT_BASE ?? "http://127.0.0.1:3200";
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) throw new Error("red-team harness refuses to run against non-local targets");
export const DATA = process.env.RT_DATA; // TEND_DATA_DIR of the local server (for the mail outbox)
export const ADMIN_TOKEN = process.env.RT_ADMIN_TOKEN;
export const PW = "correct horse battery staple 42";

export async function call(method, p, { body, cookie, key, headers = {}, raw } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: { ...(body !== undefined && { "content-type": "application/json" }), ...(cookie && { cookie }), ...(key && { authorization: `Bearer ${key}` }), ...headers },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    redirect: "manual",
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, body: json, text, headers: res.headers, setCookie: res.headers.get("set-cookie") };
}
export const cookieOf = (r) => r.setCookie?.split(";")[0];

async function mailTo(email, wait = 4000) {
  for (const end = Date.now() + wait; ; await new Promise((r) => setTimeout(r, 150))) {
    let files = [];
    try { files = readdirSync(path.join(DATA, "outbox")).filter((f) => f.includes(email)).sort(); } catch {}
    if (files.length) return readFileSync(path.join(DATA, "outbox", files.at(-1)), "utf8");
    if (Date.now() > end) return "";
  }
}

/** Creates a verified, approved account and returns its session cookie. */
export async function makeAccount(email) {
  await call("POST", "/api/account/register", { body: { email, password: PW } });
  const mail = await mailTo(email);
  const token = /#token=([A-Za-z0-9_-]{43})/.exec(mail)?.[1];
  if (!token) throw new Error("no verification mail for " + email);
  await call("POST", "/api/account/verify", { body: { token, password: PW } });
  const admin = cookieOf(await call("POST", "/api/operator/session", { body: { token: ADMIN_TOKEN } }));
  const users = (await call("GET", "/api/admin/users", { cookie: admin })).body.users;
  const u = users.find((x) => x.email === email);
  await call("POST", `/api/admin/users/${u.id}`, { cookie: admin, body: { action: "approve" } });
  const s = await call("POST", "/api/account/sign-in", { body: { email, password: PW } });
  return { email, cookie: cookieOf(s), admin };
}

export async function makeAgent(tenant, name, policyRules, enforcement = "enforce") {
  const r = (await call("POST", "/api/v1/agents", { cookie: tenant.cookie, body: { name, model: "rt-model", provider: "Custom" } })).body;
  const pol = await call("POST", `/api/v1/agents/${r.agent.id}/policy`, { cookie: tenant.cookie, body: { rules: policyRules, enforcement } });
  if (pol.status >= 300) throw new Error("policy refused: " + pol.text);
  return { id: r.agent.id, key: r.apiKey };
}

export const results = [];
export function record(id, area, title, verdict, evidence) {
  results.push({ id, area, title, verdict, evidence });
  // A failed check must fail the process (and so the CI step): BROKEN and INCONCLUSIVE both count.
  if (verdict === "BROKEN" || String(verdict).startsWith("INCONCLUSIVE")) process.exitCode = 1;
  const tag = verdict === "HELD" ? "HELD  " : verdict === "BROKEN" ? "BROKEN" : verdict;
  console.log(`[${tag}] ${id} ${title}${evidence ? "\n         " + String(evidence).replace(/\n/g, "\n         ").slice(0, 600) : ""}`);
}
export const short = (r) => `${r.status} ${r.body?.error ?? r.body?.status ?? ""}`.trim();
