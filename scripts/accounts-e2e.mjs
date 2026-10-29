#!/usr/bin/env node
// Accounts and workspaces end to end, over HTTP, against an isolated production build: sign-up, the confirmation mail (the local outbox of a
// local-only server), admin approval, sign-in, and then two accounts trying every operator route on each other's agents, approvals and
// policies. Agent API keys are used alongside, to show they keep working and stay inside their workspace. Nothing external is contacted.
//
//   npm run build && npm run e2e:accounts
import "./node-check.mjs";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startIsolatedServer } from "./isolated-server.mjs";

const root = path.resolve(import.meta.dirname, "..");
const ADMIN = `e2e_admin_${randomBytes(20).toString("hex")}`;
const dir = mkdtempSync(path.join(tmpdir(), "tend-accounts-e2e-"));
let URL_ = "";
let passed = 0, failed = 0;
const check = (ok, text) => { ok ? passed++ : failed++; console.log(`${ok ? "ok  " : "FAIL"} ${text}`); };

async function call(method, p, { body, cookie, key } = {}) {
  const res = await fetch(URL_ + p, { method, headers: { ...(body !== undefined && { "content-type": "application/json" }), ...(cookie && { cookie }), ...(key && { authorization: `Bearer ${key}` }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, body: data, setCookie: res.headers.get("set-cookie") };
}
const cookieOf = (r) => r.setCookie?.split(";")[0];
const mailTo = async (email, wait = 3000) => {
  // Mails are sent after the response; the outbox may take a moment.
  for (const end = Date.now() + wait; ; await new Promise((r) => setTimeout(r, 100))) {
    let files = [];
    try { files = readdirSync(path.join(dir, "outbox")).filter((f) => f.includes(email)).sort(); } catch {}
    if (files.length || Date.now() > end) return files.length ? readFileSync(path.join(dir, "outbox", files.at(-1)), "utf8") : "";
  }
};
const tokenIn = (mail) => /#token=([A-Za-z0-9_-]{43})/.exec(mail)?.[1];
const PW = "correct horse battery staple";

async function account(email) {
  const r = await call("POST", "/api/account/register", { body: { email, password: PW } });
  const token = tokenIn(await mailTo(email));
  const v = await call("POST", "/api/account/verify", { body: { token } });
  return { register: r, verified: v.status === 200 };
}

async function main() {
  const server = await startIsolatedServer({ root, env: { TEND_ADMIN_TOKEN: ADMIN, TEND_DATA_DIR: dir } });
  URL_ = server.url;
  try {
    console.log(`isolated TEND on ${URL_}\n`);
    console.log("-- signing up");
    const a = await account("ada@example.com"), b = await account("bo@example.com");
    check(a.register.status === 202 && a.verified && b.verified, "two people sign up and confirm their addresses from the mailed link");
    const again = await call("POST", "/api/account/register", { body: { email: "ada@example.com", password: "a different long password" } });
    check(again.status === a.register.status && JSON.stringify(again.body) === JSON.stringify(a.register.body), "signing up with a taken address gets exactly the same answer");
    const early = await call("POST", "/api/account/sign-in", { body: { email: "ada@example.com", password: PW } });
    check(early.status === 403 && early.body?.error === "pending_approval" && !early.setCookie, "before approval: no session, and the person is told why");
    const wrong = await call("POST", "/api/account/sign-in", { body: { email: "ada@example.com", password: "wrong password here" } });
    const nobody = await call("POST", "/api/account/sign-in", { body: { email: "nobody@example.com", password: PW } });
    check(wrong.status === 401 && nobody.status === 401 && wrong.body?.message === nobody.body?.message, "a wrong password and an unknown address get the same error");
    check((await call("GET", "/api/v1/state")).status === 401, "without a session the dashboard data is refused");

    console.log("\n-- the admin approves");
    const admin = cookieOf(await call("POST", "/api/operator/session", { body: { token: ADMIN } }));
    const users = (await call("GET", "/api/admin/users", { cookie: admin })).body.users;
    for (const u of users) await call("POST", `/api/admin/users/${u.id}`, { cookie: admin, body: { action: "approve" } });
    check(users.length === 2 && (await mailTo("ada@example.com")).includes("approved"), "both accounts approved; the approval is mailed");
    const A = cookieOf(await call("POST", "/api/account/sign-in", { body: { email: "ada@example.com", password: PW } }));
    const B = cookieOf(await call("POST", "/api/account/sign-in", { body: { email: "bo@example.com", password: PW } }));
    const viewA = (await call("GET", "/api/v1/state", { cookie: A })).body;
    check(viewA?.viewer?.account?.email === "ada@example.com" && viewA.viewer.admin === false, "Ada is signed in as herself, not as the admin");
    check((await call("GET", "/api/admin/users", { cookie: A })).status === 403, "an account cannot open the admin's beta access list");

    console.log("\n-- Ada's agent, through its own API key");
    const reg = (await call("POST", "/api/v1/agents", { cookie: A, body: { name: "Mailer", model: "m", provider: "Custom" } })).body;
    const id = reg.agent.id, key = reg.apiKey;
    await call("POST", `/api/v1/agents/${id}/policy`, { cookie: A, body: { rules: [{ tool: "send_email", action: "send", effect: "approve" }], enforcement: "enforce" } });
    const ask = await call("POST", "/api/v1/authorizations", { key, body: { tool: "send_email", action: "send", resource: "team-1" } });
    check(ask.status === 201 && ask.body.status === "pending", "the agent's key works as before: its request waits for a person");
    const cp = (await call("POST", "/api/v1/central-policies", { cookie: A, body: { name: "Baseline", rules: [{ tool: "send_email", action: "send", effect: "approve" }] } })).body.centralPolicy;

    console.log("\n-- Bo tries everything on Ada's things");
    const stateB = (await call("GET", "/api/v1/state", { cookie: B })).body;
    check(stateB.projection.agents.length === 0 && stateB.projection.authorizations.length === 0 && Object.keys(stateB.keys ?? {}).length === 0, "Bo's dashboard shows none of Ada's agents, requests or keys");
    const eventsB = (await call("GET", "/api/v1/events?since=0", { cookie: B })).body;
    check(eventsB.events.length === 0, "nor does Bo's event stream");
    check((await call("GET", "/api/v1/central-policies", { cookie: B })).body.centralPolicies.length === 0, "nor Ada's central policies");
    const attempts = [
      ["GET", `/api/v1/agents/${id}/policy`], ["POST", `/api/v1/agents/${id}/policy`, { rules: [{ tool: "send_email", action: "send", effect: "allow" }], enforcement: "enforce" }],
      ["POST", `/api/v1/agents/${id}/control`, { action: "pause" }], ["POST", `/api/v1/agents/${id}/keys`], ["DELETE", `/api/v1/agents/${id}/keys`],
      ["POST", `/api/v1/agents/${id}/check-in-requests`], ["GET", `/api/v1/agents/${id}/verification`],
      ["POST", `/api/v1/reviews/${ask.body.id}`, { status: "approved" }],
      ["POST", `/api/v1/central-policies/${cp.id}`, { rules: [] }], ["POST", `/api/v1/central-policies/${cp.id}/assignments`, { assign: [id] }],
    ];
    const answers = [];
    for (const [m, p, body] of attempts) answers.push((await call(m, p, { cookie: B, body })).status);
    check(answers.every((s) => s === 404), `every one of ${attempts.length} operator routes answers Bo's attempt as not found (${[...new Set(answers)].join(", ")})`);
    const missing = await call("GET", "/api/v1/agents/no-such-agent/policy", { cookie: B });
    const taken = await call("GET", `/api/v1/agents/${id}/policy`, { cookie: B });
    check(missing.status === taken.status && missing.body?.error === taken.body?.error, "an id of Ada's looks exactly like an id that does not exist");
    const bcp = (await call("POST", "/api/v1/central-policies", { cookie: B, body: { name: "Baseline", rules: [] } }));
    check(bcp.status === 201, "Bo can use the same policy name in his own workspace");
    check((await call("POST", `/api/v1/central-policies/${bcp.body.centralPolicy.id}/assignments`, { cookie: B, body: { assign: [id] } })).status === 404, "Bo cannot put his policy on Ada's agent");

    console.log("\n-- Ada carries on, unaffected");
    const stillPending = (await call("GET", `/api/v1/authorizations/${ask.body.id}`, { key })).body;
    check(stillPending.status === "pending", "Ada's request is still waiting: nothing Bo did changed it");
    check((await call("POST", `/api/v1/reviews/${ask.body.id}`, { cookie: A, body: { status: "approved" } })).status === 200, "Ada approves her own agent's request");
    const tok = (await call("POST", `/api/v1/authorizations/${ask.body.id}/token`, { key, body: {} })).body;
    const used = await call("POST", `/api/v1/authorizations/${ask.body.id}/consume`, { key, body: { token: tok.token, tool: "send_email", action: "send", resource: "team-1" } });
    check(used.status === 200 && used.body.authorized === true, "the agent spends its single-use token");
    const replay = await call("POST", `/api/v1/authorizations/${ask.body.id}/consume`, { key, body: { token: tok.token, tool: "send_email", action: "send", resource: "team-1" } });
    check(replay.status >= 400, "the same token cannot be used twice");
    check((await call("POST", "/api/v1/authorizations", { key: "tend_sk_" + "x".repeat(32), body: { tool: "send_email", action: "send" } })).status === 401, "an unknown agent key is refused");
    check((await call("GET", "/api/v1/state", { key })).status === 401, "an agent key cannot read the dashboard");

    console.log("\n-- signing out and resetting the password");
    await call("DELETE", "/api/operator/session", { cookie: A });
    check((await call("GET", "/api/v1/state", { cookie: A })).status === 401, "after signing out, the old cookie is dead");
    const fg1 = await call("POST", "/api/account/forgot", { body: { email: "ada@example.com" } });
    const fg2 = await call("POST", "/api/account/forgot", { body: { email: "nobody@example.com" } });
    check(fg1.status === fg2.status && JSON.stringify(fg1.body) === JSON.stringify(fg2.body), "forgot password answers the same for any address");
    const resetToken = tokenIn(await mailTo("ada@example.com"));
    const B2 = B; // Bo stays signed in; Ada's reset must not touch him
    check((await call("POST", "/api/account/reset", { body: { token: resetToken, password: "a whole new passphrase" } })).status === 200, "Ada sets a new password from the mailed link");
    check((await call("POST", "/api/account/reset", { body: { token: resetToken, password: "and yet another one" } })).status === 400, "the reset link works once");
    check((await call("POST", "/api/account/sign-in", { body: { email: "ada@example.com", password: PW } })).status === 401, "the old password no longer works");
    check((await call("POST", "/api/account/sign-in", { body: { email: "ada@example.com", password: "a whole new passphrase" } })).status === 200, "the new one does");
    check((await call("GET", "/api/v1/state", { cookie: B2 })).status === 200, "Bo was not signed out by Ada's reset");

    console.log("\n-- the admin disables Bo");
    const bo = (await call("GET", "/api/admin/users", { cookie: admin })).body.users.find((u) => u.email === "bo@example.com");
    await call("POST", `/api/admin/users/${bo.id}`, { cookie: admin, body: { action: "disable" } });
    check((await call("GET", "/api/v1/state", { cookie: B })).status === 401, "Bo's session ends at once");
  } finally {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exit(1); });
