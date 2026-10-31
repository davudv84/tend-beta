#!/usr/bin/env node
// The private beta without the admin (TEND_ADMIN=0), end to end over HTTP against an isolated production build. First the server runs with the
// admin, and one person signs up and confirms (so their account waits for approval). Then it restarts on the same database with TEND_ADMIN=0:
// that person can sign in, a new person signs up, confirms and signs in at once, the admin token and every admin page and route are gone, the
// dashboard stays closed to visitors, two accounts cannot touch each other's things, and agent keys and policies are enforced as before.
//
//   npm run build && npm run e2e:open-beta
import "./node-check.mjs";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startIsolatedServer } from "./isolated-server.mjs";

const root = path.resolve(import.meta.dirname, "..");
const ADMIN = `e2e_admin_${randomBytes(20).toString("hex")}`;
const dir = mkdtempSync(path.join(tmpdir(), "tend-open-beta-e2e-"));
let URL_ = "";
let passed = 0, failed = 0;
const check = (ok, text) => { if (ok) passed++; else failed++; console.log(`${ok ? "ok  " : "FAIL"} ${text}`); };

async function call(method, p, { body, cookie, key } = {}) {
  const res = await fetch(URL_ + p, { method, redirect: "manual", headers: { ...(body !== undefined && { "content-type": "application/json" }), ...(cookie && { cookie }), ...(key && { authorization: `Bearer ${key}` }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, body: data, text, setCookie: res.headers.get("set-cookie") };
}
const cookieOf = (r) => r.setCookie?.split(";")[0];
const mailTo = async (email, wait = 3000) => {
  for (const end = Date.now() + wait; ; await new Promise((r) => setTimeout(r, 100))) {
    let files = [];
    try { files = readdirSync(path.join(dir, "outbox")).filter((f) => f.includes(email)).sort(); } catch {}
    if (files.length || Date.now() > end) return files.length ? readFileSync(path.join(dir, "outbox", files.at(-1)), "utf8") : "";
  }
};
const tokenIn = (mail) => /#token=([A-Za-z0-9_-]{43})/.exec(mail)?.[1];
const PW = "correct horse battery staple";
const signUp = async (email) => (await call("POST", "/api/account/register", { body: { email, password: PW } })).status;
const confirm = async (email) => call("POST", "/api/account/verify", { body: { token: tokenIn(await mailTo(email)), password: PW } });
const signIn = (email, password = PW) => call("POST", "/api/account/sign-in", { body: { email, password } });

async function main() {
  try {
    console.log("-- with the admin: Wes signs up and confirms, and waits for approval");
    let server = await startIsolatedServer({ root, env: { TEND_ADMIN_TOKEN: ADMIN, TEND_DATA_DIR: dir } });
    URL_ = server.url;
    try {
      await signUp("wes@example.com");
      const v = await confirm("wes@example.com");
      check(v.status === 200 && v.body?.approved === false, "confirmed, not approved yet");
      const early = await signIn("wes@example.com");
      check(early.status === 403 && early.body?.error === "pending_approval" && !early.setCookie, "Wes cannot sign in while approval is required");
    } finally {
      await server.stop();
    }

    console.log("\n-- the same database, restarted with TEND_ADMIN=0 (the admin token is still set, and must do nothing)");
    server = await startIsolatedServer({ root, env: { TEND_ADMIN_TOKEN: ADMIN, TEND_ADMIN: "0", TEND_DATA_DIR: dir } });
    URL_ = server.url;
    try {
      const viewer = (await call("GET", "/api/operator/session")).body.viewer;
      check(viewer.public === false && viewer.operatorAvailable === false && viewer.approval === false && viewer.accounts === true && viewer.canAct === false, `visitor view: private, no admin sign-in, no approval step (${JSON.stringify(viewer)})`);
      const wes = await signIn("wes@example.com");
      check(wes.status === 200 && !!cookieOf(wes), "Wes, who was waiting, signs in now");

      console.log("\n-- the admin is gone");
      const token = await call("POST", "/api/operator/session", { body: { token: ADMIN } });
      check(token.status === 404 && !token.setCookie, `the correct admin token gets 404 and no cookie (${token.status})`);
      for (const p of ["/operator", "/admin/users"]) check((await call("GET", p)).status === 404, `${p} page is not found`);
      for (const p of ["/api/admin/users", "/api/admin/audit"]) {
        const out = await call("GET", p), inside = await call("GET", p, { cookie: cookieOf(wes) });
        check(out.status === 404 && inside.status === 404, `${p}: 404 signed out and signed in (${out.status} / ${inside.status})`);
      }
      check((await call("POST", "/api/admin/users/u_x", { cookie: cookieOf(wes), body: { action: "approve" } })).status === 404, "approving through the API is not found either");
      check((await call("POST", "/api/v1/demo/reset", { cookie: cookieOf(wes) })).status === 404, "nor the admin-only demo reset");
      const page = await call("GET", "/account/sign-in");
      check(page.status === 200 && !page.text.includes('href="/operator"'), "the sign-in page has no admin link");
      const front = await call("GET", "/");
      check(front.status === 200 && front.text.includes('href="/account/sign-in"') && !front.text.includes('href="/operator"'), "the front page's Sign in goes to the account sign-in, not the removed admin page");
      check((await call("GET", "/api/v1/state")).status === 401 && (await call("GET", "/api/v1/events?since=0")).status === 401, "signed out, the dashboard data is refused");

      console.log("\n-- Ana: sign up, confirm, sign in");
      check(await signUp("ana@example.com") === 202, "Ana signs up");
      const before = await signIn("ana@example.com");
      check(before.status === 403 && before.body?.error === "email_unverified" && !before.setCookie, "before confirming: no session");
      const v = await confirm("ana@example.com");
      check(v.status === 200 && v.body?.approved === true, "the mailed link confirms the address, and the account is ready");
      const bad = await signIn("ana@example.com", "wrong password here");
      check(bad.status === 401 && bad.body?.error === "invalid_credentials", "a wrong password is still refused");
      const A = cookieOf(await signIn("ana@example.com"));
      const stateA = (await call("GET", "/api/v1/state", { cookie: A })).body;
      check(stateA?.viewer?.account?.email === "ana@example.com" && stateA.viewer.admin === false && stateA.viewer.workspace !== "default", "Ana is signed in to her own workspace, not the admin's");
      await signUp("ben@example.com");
      await confirm("ben@example.com");
      const B = cookieOf(await signIn("ben@example.com"));

      console.log("\n-- Ana's agent is enforced through its own key");
      const reg = (await call("POST", "/api/v1/agents", { cookie: A, body: { name: "Mailer", model: "m", provider: "Custom" } })).body;
      const id = reg.agent.id, key = reg.apiKey;
      const v0 = (await call("GET", `/api/v1/agents/${id}/policy`, { cookie: A })).body.version;
      const pol = await call("POST", `/api/v1/agents/${id}/policy`, { cookie: A, body: { enforcement: "enforce", expectedVersion: v0, rules: [
        { tool: "read_note", action: "read", effect: "allow" }, { tool: "send_email", action: "send", effect: "approve" }, { tool: "delete_file", action: "delete", effect: "deny" }] } });
      check(pol.status === 200, "Ana saves a policy");
      const allow = await call("POST", "/api/v1/authorize", { key, body: { tool: "read_note", action: "read", resource: "n1" } });
      const ask = await call("POST", "/api/v1/authorize", { key, body: { tool: "send_email", action: "send", resource: "team" } });
      const deny = await call("POST", "/api/v1/authorize", { key, body: { tool: "delete_file", action: "delete", resource: "f1" } });
      const none = await call("POST", "/api/v1/authorize", { key, body: { tool: "wire_money", action: "send", resource: "x" } });
      check(allow.status === 200 && allow.body.authorized === true, "allowed tool: authorized once");
      check(ask.status === 202 && ask.body.status === "pending", "approval tool: waits for a person");
      check(deny.status === 403 && deny.body.authorized === false, "denied tool: refused");
      check(none.status === 403 && none.body.authorized === false, "a tool with no rule: refused");
      check((await call("POST", "/api/v1/authorize", { key: "tend_sk_" + "x".repeat(32), body: { tool: "read_note", action: "read" } })).status === 401, "a made-up agent key is refused");
      check((await call("GET", "/api/v1/state", { key })).status === 401, "an agent key cannot read the dashboard");

      console.log("\n-- Ben tries Ana's things");
      const stateB = (await call("GET", "/api/v1/state", { cookie: B })).body;
      check(stateB.projection.agents.length === 0 && stateB.projection.authorizations.length === 0, "Ben's dashboard shows none of Ana's agents or requests");
      check((await call("GET", "/api/v1/events?since=0", { cookie: B })).body.events.length === 0, "nor her events");
      const attempts = [["GET", `/api/v1/agents/${id}/policy`], ["POST", `/api/v1/agents/${id}/control`, { action: "pause" }], ["POST", `/api/v1/agents/${id}/keys`],
        ["POST", `/api/v1/reviews/${ask.body.id}`, { status: "approved" }]];
      const answers = [];
      for (const [m, p, body] of attempts) answers.push((await call(m, p, { cookie: B, body })).status);
      check(answers.every((s) => s === 404), `every attempt on Ana's agent and approval is not found (${[...new Set(answers)].join(", ")})`);
      check((await call("POST", `/api/v1/reviews/${ask.body.id}`, { cookie: A, body: { status: "approved" } })).status === 200, "Ana approves her own agent's request");
      const spent = await call("POST", `/api/v1/authorizations/${ask.body.id}/spend`, { key, body: { tool: "send_email", action: "send", resource: "team" } });
      const again = await call("POST", `/api/v1/authorizations/${ask.body.id}/spend`, { key, body: { tool: "send_email", action: "send", resource: "team" } });
      check(spent.status === 200 && spent.body.authorized === true && again.status >= 400, "the approval is spent once, never twice");

      console.log("\n-- the remaining routes: guarded, and inside each workspace");
      await signUp("cy@example.com");
      const r1 = await call("POST", "/api/account/resend", { body: { email: "cy@example.com" } }), r2 = await call("POST", "/api/account/resend", { body: { email: "nobody-here@example.com" } });
      check(r1.status === 202 && JSON.stringify(r1.body) === JSON.stringify(r2.body), "a new confirmation link: the same answer for any address");
      check((await call("GET", "/api/v1/check-ins")).status === 200, "the check-in protocol is public (no data in it)");
      check((await call("POST", "/api/v1/check-ins", { body: { answers: {} } })).status === 401, "posting a check-in needs an agent key");
      for (const [m, p, body] of [["GET", "/api/v1/integrations/status"], ["POST", "/api/v1/policy-simulations", { rules: [] }], ["POST", "/api/v1/sample-agent", { step: "start" }]])
        check((await call(m, p, { body })).status === 403, `${p}: refused signed out`);
      const sim = (who) => call("POST", "/api/v1/policy-simulations", { cookie: who, body: { agentId: id, rules: [{ tool: "send_email", action: "send", effect: "allow" }] } });
      const simA = await sim(A), simB = await sim(B);
      check(simA.status === 200 && simB.status === 404, `a policy simulation works on Ana's own agent, and Ben's attempt on it is not found (${simA.status} / ${simB.status})`);
      const claude = (await call("POST", "/api/v1/agents", { cookie: A, body: { name: "Claude helper", model: "claude-haiku-4-5", provider: "Anthropic" } })).body.agent.id;
      const stA = await call("GET", "/api/v1/integrations/status", { cookie: A }), stB = await call("GET", "/api/v1/integrations/status", { cookie: B });
      check(stA.status === 200 && stA.text.includes(claude) && stB.status === 200 && !stB.text.includes(claude), "integration status shows only the caller's own agents");
      check((await call("POST", "/api/v1/sample-agent", { cookie: B, body: { step: "start" } })).status === 200, "the browser sample agent runs for a signed-in account");
      check((await call("POST", "/api/v1/demo/check-ins", { cookie: B, body: {} })).status === 404, "the admin-only demo check-ins do not exist");
    } finally {
      await server.stop();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exit(1); });
