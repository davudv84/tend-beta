#!/usr/bin/env node
// The developer onboarding path, reproducible: what a new developer does, step by step, over HTTP against an isolated production build,
// with every step checked and timed. It measures the machine's part only; how long a person takes is measured with the timed checklist in
// docs/beta/integration-guide.md, by a person. A scripted run is never evidence of a five-minute human setup.
//
//   npm run build && npm run onboarding:test
import "./node-check.mjs";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startIsolatedServer } from "./isolated-server.mjs";

const root = path.resolve(import.meta.dirname, "..");
const ADMIN = `onb_admin_${randomBytes(20).toString("hex")}`;
const dir = mkdtempSync(path.join(tmpdir(), "tend-onboarding-"));
const work = mkdtempSync(path.join(tmpdir(), "tend-onboarding-dev-")); // the developer's own folder
let URL_ = "";
const steps = [];
const failures = [];
async function step(name, fn) {
  const t = Date.now();
  try {
    const note = await fn();
    steps.push({ name, ms: Date.now() - t, ok: true, note });
    console.log(`ok   ${String(Date.now() - t).padStart(5)} ms  ${name}${note ? `: ${note}` : ""}`);
  } catch (e) {
    steps.push({ name, ms: Date.now() - t, ok: false });
    failures.push(name);
    console.log(`FAIL ${String(Date.now() - t).padStart(5)} ms  ${name}: ${e.message}`);
  }
}
const must = (ok, why) => { if (!ok) throw new Error(why); };
async function call(method, p, { body, cookie } = {}) {
  const res = await fetch(URL_ + p, { method, headers: { ...(body !== undefined && { "content-type": "application/json" }), ...(cookie && { cookie }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, cookie: res.headers.get("set-cookie")?.split(";")[0] };
}
const mail = async (to) => {
  for (let i = 0; i < 40; i++) {
    const f = (() => { try { return readdirSync(path.join(dir, "outbox")).filter((x) => x.includes(to)).sort().at(-1); } catch { return undefined; } })();
    if (f) return readFileSync(path.join(dir, "outbox", f), "utf8");
    await new Promise((r) => setTimeout(r, 100));
  }
  return "";
};

async function main() {
  const server = await startIsolatedServer({ root, env: { TEND_ADMIN_TOKEN: ADMIN, TEND_DATA_DIR: dir } });
  URL_ = server.url;
  const email = "dev@example.com", password = "a developer passphrase";
  let cookie = "", agent = null, out = "";
  const t0 = Date.now();
  try {
    console.log(`isolated TEND on ${URL_}\n`);
    await step("1. create an account", async () => must((await call("POST", "/api/account/register", { body: { email, password } })).status === 202, "sign-up refused"));
    await step("   confirm the address from the mail", async () => {
      const token = /#token=([A-Za-z0-9_-]{43})/.exec(await mail(email))?.[1];
      must(token && (await call("POST", "/api/account/verify", { body: { token } })).status === 200, "no working link in the mail");
    });
    await step("   (the admin approves the account)", async () => {
      const admin = (await call("POST", "/api/operator/session", { body: { token: ADMIN } })).cookie;
      const u = (await call("GET", "/api/admin/users", { cookie: admin })).body.users[0];
      must((await call("POST", `/api/admin/users/${u.id}`, { cookie: admin, body: { action: "approve" } })).status === 200, "approval failed");
    });
    await step("   sign in", async () => { cookie = (await call("POST", "/api/account/sign-in", { body: { email, password } })).cookie; must(cookie, "no session"); });
    await step("2. register an agent", async () => {
      const r = await call("POST", "/api/v1/agents", { cookie, body: { name: "Support bot", model: "claude-haiku-4-5", provider: "Anthropic" } });
      must(r.status === 201, `register answered ${r.status}`);
      agent = r.body;
      return "the key is shown once";
    });
    await step("3. connect: download the SDK and the sample from TEND", async () => {
      for (const f of ["tend.mjs", "sample.mjs"]) {
        const r = await fetch(`${URL_}/sdk/${f}`);
        must(r.ok, `/sdk/${f} answered ${r.status}`);
        writeFileSync(path.join(work, f), await r.text());
      }
      return "two files, no install";
    });
    const run = (env) => new Promise((resolve) => {
      const c = spawn(process.execPath, ["sample.mjs"], { cwd: work, env: { PATH: process.env.PATH, ...env } });
      let text = "";
      c.stdout.on("data", (d) => (text += d));
      c.stderr.on("data", (d) => (text += d));
      c.on("close", (code) => resolve({ code, text }));
    });
    await step("   run it before any policy: everything is blocked, with the fix", async () => {
      const r = await run({ TEND_URL: URL_, TEND_AGENT_KEY: agent.apiKey });
      must(r.code === 0 && (r.text.match(/BLOCKED/g) ?? []).length === 4 && /no rule for read_record · call yet/.test(r.text), r.text.slice(-300));
      out = r.text;
      return "4 of 4 blocked, each saying which rule to add";
    });
    await step("4. apply the policy the sample printed", async () => {
      const policy = JSON.parse(out.slice(out.indexOf("[")));
      const v = (await call("GET", `/api/v1/agents/${agent.agent.id}/policy`, { cookie })).body.version;
      must((await call("POST", `/api/v1/agents/${agent.agent.id}/policy`, { cookie, body: { rules: policy, enforcement: "enforce", expectedVersion: v } })).status === 200, "policy refused");
      return `${policy.length} rules, one with an argument condition`;
    });
    await step("5. execute protected tools (the developer approves the one that waits)", async () => {
      let approving = true;
      const approver = (async () => {
        while (approving) {
          const p = (await call("GET", "/api/v1/state", { cookie })).body.projection.authorizations.find((a) => a.status === "pending");
          if (p) { await call("POST", `/api/v1/reviews/${p.id}`, { cookie, body: { status: "approved" } }); return; }
          await new Promise((r) => setTimeout(r, 150));
        }
      })();
      const r = await run({ TEND_URL: URL_, TEND_AGENT_KEY: agent.apiKey });
      approving = false;
      await approver;
      const lines = r.text.split("\n").filter((l) => /^(ran|BLOCKED)/.test(l));
      must(r.code === 0 && lines.length === 4, r.text.slice(-300));
      must(/^ran.*read_record/.test(lines[0]) && /^ran.*colleague@example\.com/.test(lines[1]) && /^ran.*gmail/.test(lines[2]) && /^BLOCKED.*delete_file/.test(lines[3]), lines.join(" | "));
      return "read ran; email inside the domain ran; outside it waited and ran after approval; delete never";
    });
    await step("6. see every decision in the dashboard", async () => {
      const st = (await call("GET", "/api/v1/state", { cookie })).body.projection;
      const mine = st.authorizations.filter((a) => a.agentId === agent.agent.id);
      const by = mine.reduce((m, a) => ((m[a.status] = (m[a.status] ?? 0) + 1), m), {});
      must(by.consumed === 3 && by.denied >= 5, JSON.stringify(by));
      return `${mine.length} decisions recorded: ${JSON.stringify(by)}`;
    });
  } finally {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
  const total = Date.now() - t0;
  console.log(`\n${steps.filter((s) => s.ok).length}/${steps.length} steps passed in ${(total / 1000).toFixed(1)} s of machine time.`);
  console.log(`What a developer does: ${steps.filter((s) => /^\d\./.test(s.name)).length} steps, 2 downloads, 2 environment variables, 1 policy paste, no package install.`);
  console.log("This is not a measurement of a person's time: use the timed checklist in docs/beta/integration-guide.md for that.");
  process.exitCode = failures.length ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exit(1); });
