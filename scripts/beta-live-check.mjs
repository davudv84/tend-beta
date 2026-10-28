// Checks LIVE beta instances (or a local rehearsal of them) from outside, the way a tester or an attacker would meet them.
//
//   npm run beta:live -- alice=https://alice-tend.vercel.app bob=https://bob-tend.vercel.app carol=https://carol-tend.vercel.app
//
// Admin tokens come from beta-envs/<name>/vercel.env; TEND_PROTECTION_BYPASS (also from that file, or the environment) is sent if the instance sits
// behind Vercel Deployment Protection. It signs in once per instance, registers one agent called "beta live check", proves the isolation (that agent's
// key and that session are refused by every OTHER instance), then revokes the key, disables the agent and signs out. It never prints a token or key.
// It leaves one disabled agent row behind in each instance (the event log is append-only by design).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAll } from "./beta-config.mjs";

const fetchJson = async (url, init = {}) => {
  const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20_000), ...init });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {}
  return { status: res.status, headers: res.headers, body, text };
};

/** @param instances { name, url, token, bypass? }[]   @returns {{ instance: string, ok: boolean, text: string }[]} */
export async function liveCheck({ instances, allowHttp = false, expectStorage = "postgres" }) {
  const out = [];
  const rec = (instance, ok, text) => out.push({ instance, ok, text });
  const hdr = (i, extra = {}) => ({ ...(i.bypass && { "x-vercel-protection-bypass": i.bypass }), ...extra });
  const keys = {}, cookies = {};

  for (const i of instances) {
    const n = i.name;
    const call = (p, init = {}) => fetchJson(i.url + p, { ...init, headers: hdr(i, init.headers) });
    try {
      rec(n, i.url.startsWith("https://") || allowHttp, i.url.startsWith("https://") ? "served over https" : `NOT https (${i.url})`);
      const health = await call("/api/health");
      rec(n, health.status === 200 && health.body?.storage === expectStorage, `health ok on ${expectStorage} storage (status ${health.status}, storage ${health.body?.storage})`);

      const page = await call("/operator");
      const csp = page.headers.get("content-security-policy") ?? "";
      const scriptSrc = csp.split("; ").find((d) => d.startsWith("script-src")) ?? "";
      rec(n, /'nonce-[A-Za-z0-9+/=]{16,}'/.test(scriptSrc) && !/'unsafe-(inline|eval)'/.test(scriptSrc) && /frame-ancestors 'none'/.test(csp) && /object-src 'none'/.test(csp), "Content-Security-Policy: nonce-only scripts, no framing, no plugins");
      rec(n, /max-age=\d{7,}/.test(page.headers.get("strict-transport-security") ?? ""), "Strict-Transport-Security present (max-age of months)");
      rec(n, page.headers.get("x-frame-options") === "DENY" && page.headers.get("x-content-type-options") === "nosniff" && !page.headers.get("x-powered-by"), "X-Frame-Options DENY, nosniff, no X-Powered-By");

      const vis = await call("/api/v1/state");
      const status = await call("/api/v1/integrations/status");
      const inbox = await call("/api/v1/agent/inbox");
      rec(n, vis.status === 401 && [401, 403].includes(status.status) && inbox.status === 401, `a visitor sees nothing (state ${vis.status}, integrations ${status.status}, agent inbox ${inbox.status})`);

      const wrong = await call("/api/operator/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "definitely-not-the-token-0123456789abcdef" }) });
      rec(n, wrong.status === 401, `a wrong admin token is refused (${wrong.status})`);

      const login = await call("/api/operator/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: i.token }) });
      const setCookie = login.headers.get("set-cookie") ?? "";
      const secure = /^__Host-tend_operator=/.test(setCookie) && /; Secure/.test(setCookie) && /; HttpOnly/.test(setCookie) && /; SameSite=Strict/.test(setCookie) && /; Path=\//.test(setCookie) && !/Domain=/i.test(setCookie);
      rec(n, login.status === 200 && secure, `sign-in works and the session cookie is __Host-, Secure, HttpOnly, SameSite=Strict (status ${login.status})`);
      if (login.status !== 200) continue;
      const cookie = setCookie.split(";")[0];
      cookies[n] = cookie;

      const state = await call("/api/v1/state", { headers: { cookie } });
      rec(n, state.status === 200 && !(state.body?.projection?.agents ?? []).some((a) => a.origin === "demo"), "operator sees the instance, with no simulated demo agents");

      const reg = await call("/api/v1/agents", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ name: "beta live check", model: "none", provider: "Custom" }) });
      keys[n] = { id: reg.body?.agent?.id, key: reg.body?.apiKey };
      const own = await call("/api/v1/agent/inbox", { headers: { authorization: `Bearer ${keys[n].key}` } });
      rec(n, reg.status === 201 && own.status === 200, `a key issued here works here (${own.status})`);
    } catch (e) {
      rec(n, false, `could not complete the checks: ${String(e.message).slice(0, 120)}`);
    }
  }

  // Isolation: nothing issued by one instance means anything to another.
  for (const a of instances) for (const b of instances) {
    if (a.name === b.name || !keys[a.name]?.key) continue;
    const callB = (p, init = {}) => fetchJson(b.url + p, { ...init, headers: { ...(b.bypass && { "x-vercel-protection-bypass": b.bypass }), ...init.headers } });
    const k = await callB("/api/v1/agent/inbox", { headers: { authorization: `Bearer ${keys[a.name].key}` } });
    const s = cookies[a.name] ? await callB("/api/v1/state", { headers: { cookie: cookies[a.name] } }) : { status: 401 };
    rec(`${a.name}→${b.name}`, k.status === 401 && s.status === 401, `${a.name}'s agent key (${k.status}) and operator session (${s.status}) are refused by ${b.name}`);
  }

  // Clean up what this run created.
  for (const i of instances) {
    const cookie = cookies[i.name], k = keys[i.name];
    if (!cookie || !k?.id) continue;
    const h = { cookie, "content-type": "application/json", ...(i.bypass && { "x-vercel-protection-bypass": i.bypass }) };
    const revoked = await fetchJson(`${i.url}/api/v1/agents/${k.id}/keys`, { method: "DELETE", headers: h });
    await fetchJson(`${i.url}/api/v1/agents/${k.id}/control`, { method: "POST", headers: h, body: JSON.stringify({ action: "disable" }) });
    const dead = await fetchJson(`${i.url}/api/v1/agent/inbox`, { headers: { authorization: `Bearer ${k.key}`, ...(i.bypass && { "x-vercel-protection-bypass": i.bypass }) } });
    rec(i.name, revoked.status === 200 && dead.status === 401, `the check's key was revoked and no longer works (${dead.status}); its agent is disabled`);
    await fetchJson(`${i.url}/api/operator/session`, { method: "DELETE", headers: h });
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(import.meta.dirname, "..");
  const args = process.argv.slice(2);
  const allowHttp = args.includes("--allow-http");
  const pairs = args.filter((a) => a.includes("=") && !a.startsWith("--")).map((a) => a.split("="));
  const { instances: envs } = loadAll(root);
  if (!pairs.length) {
    console.error("Usage: npm run beta:live -- name=https://address [name=https://address …] [--allow-http]");
    process.exit(2);
  }
  const instances = pairs.map(([name, url]) => ({ name, url: url.replace(/\/$/, ""), token: envs[name]?.TEND_ADMIN_TOKEN, bypass: envs[name]?.TEND_PROTECTION_BYPASS ?? process.env.TEND_PROTECTION_BYPASS }));
  const missing = instances.filter((i) => !i.token).map((i) => i.name);
  if (missing.length) {
    console.error(`No admin token for ${missing.join(", ")} in beta-envs/<name>/vercel.env.`);
    process.exit(2);
  }
  const results = await liveCheck({ instances, allowHttp });
  for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"} [${r.instance}] ${r.text}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
