// Real Cursor behind TEND's hooks (npm run e2e:cursor-hooks). Needs the `cursor-agent` command, signed in (`cursor-agent login`); it runs a
// few short `cursor-agent -p` sessions in a throwaway project, against an isolated TEND server. Your own ~/.cursor and ~/.tend are not
// touched: the hooks go into the project's .cursor/hooks.json, and the key into a throwaway folder.
//
// Real: Cursor's agent choosing its tools, Cursor running TEND's preToolUse/postToolUse/session hooks, TEND's policy, approvals and log.
// It also answers what Cursor's documentation leaves open: whether the hooks run in the CLI at all, and whether preToolUse can stop a file
// write before it happens. Cursor's own permissions allow only `echo` here (.cursor/cli.json), so TEND is what stands in the way.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startIsolatedServer } from "./isolated-server.mjs";
import { presetRules } from "../src/lib/agent-presets.ts";

const root = path.resolve(import.meta.dirname, "..");
const dir = mkdtempSync(path.join(tmpdir(), "tend-cursor-hooks-"));
const project = path.join(dir, "project"), tendHome = path.join(dir, "tend-home");
let URL_ = "", passed = 0, failed = 0;
const check = (ok, text) => { if (ok) passed++; else failed++; console.log(`${ok ? "ok  " : "FAIL"} ${text}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (s) => String(s).slice(0, 140).replace(/\n/g, " ");

async function call(method, p, { body, cookie } = {}) {
  const res = await fetch(URL_ + p, { method, headers: { ...(body !== undefined && { "content-type": "application/json" }), ...(cookie && { cookie }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null), setCookie: res.headers.get("set-cookie") };
}

function cursor(prompt, timeout = 300_000) {
  return new Promise((resolve) => {
    const child = spawn("cursor-agent", ["-p", "--output-format", "json", "--trust", "--workspace", project, prompt], { cwd: project, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (b) => (out += b));
    child.stderr.on("data", (b) => (err += b));
    const timer = setTimeout(() => child.kill("SIGTERM"), timeout);
    child.on("close", (code) => { clearTimeout(timer); let result = ""; try { result = JSON.parse(out).result ?? out; } catch { result = out; } resolve({ code, result: String(result), err }); });
  });
}
const ask = (cmd) => `Use the shell tool to run exactly this command, once, and then tell me its output: ${cmd}`;
const ran = (r, marker) => new RegExp(`^${marker}$`, "m").test(r.result);

async function main() {
  const version = spawnSync("cursor-agent", ["--version"], { encoding: "utf8" });
  if (version.status !== 0) { console.log("SKIP cursor-agent is not installed"); process.exit(0); }
  const status = spawnSync("cursor-agent", ["status"], { encoding: "utf8" });
  if (/not logged in/i.test(`${status.stdout}${status.stderr}`)) { console.log("SKIP cursor-agent is not signed in. Run `cursor-agent login`, then this again."); process.exit(0); }
  console.log(`cursor-agent ${version.stdout.trim()}`);
  mkdirSync(path.join(project, ".cursor"), { recursive: true });
  writeFileSync(path.join(project, ".cursor/cli.json"), JSON.stringify({ permissions: { allow: ["Shell(echo)", "Write(**)"], deny: [] } }, null, 2));
  const server = await startIsolatedServer({ root, env: { TEND_ADMIN_TOKEN: `e2e_admin_${randomBytes(20).toString("hex")}`, TEND_ADMIN: "0", TEND_EMAIL_VERIFICATION: "0", TEND_DATA_DIR: path.join(dir, "data") } });
  URL_ = server.url;
  try {
    const pw = "correct horse battery staple";
    await call("POST", "/api/account/register", { body: { email: "owner@example.com", password: pw } });
    const cookie = (await call("POST", "/api/account/sign-in", { body: { email: "owner@example.com", password: pw } })).setCookie?.split(";")[0];
    const reg = await call("POST", "/api/v1/agents", { cookie, body: { name: "Cursor", model: "Cursor", provider: "Custom" } });
    const agentId = reg.body.agent.id, key = reg.body.apiKey;
    const pol = await call("GET", `/api/v1/agents/${agentId}/policy`, { cookie });
    await call("POST", `/api/v1/agents/${agentId}/policy`, { cookie, body: { rules: presetRules("balanced"), enforcement: "enforce", expectedVersion: pol.body.version } });

    console.log("\n-- install into a throwaway project");
    const inst = spawnSync(process.execPath, [path.join(root, "public/sdk/tend-hooks.mjs"), "install", "cursor", "--project", project, "--url", URL_, "--yes"], { env: { ...process.env, TEND_HOME: tendHome, TEND_AGENT_KEY: key }, encoding: "utf8" });
    check(inst.status === 0, `install succeeded (${inst.status}) ${inst.status ? inst.stderr : ""}`);
    const hooks = JSON.parse(readFileSync(path.join(project, ".cursor/hooks.json"), "utf8"));
    check(hooks.hooks?.preToolUse?.[0]?.failClosed === true, "preToolUse is installed with failClosed: true");
    const state = async () => (await call("GET", "/api/v1/state", { cookie })).body.projection;
    const auths = async (pred) => (await state()).authorizations.filter((a) => a.agentId === agentId && pred(a));
    const shell = (prefix) => auths((a) => a.tool === "shell" && (a.detail ?? "").includes(prefix));
    const waitFor = async (find, ms = 150_000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(1000)) { const x = await find(); if (x) return x; } };
    const decideOn = (id, s) => call("POST", `/api/v1/reviews/${id}`, { cookie, body: { status: s } });

    console.log("\n-- do the hooks run in cursor-agent at all? an allowed command");
    const a = await cursor(ask("echo tend-activity-test"));
    const allowed = await shell("echo tend-activity-test");
    check(allowed.length >= 1, `TEND was asked before the command ran (${allowed.map((x) => x.status)}; cursor exit ${a.code}: ${short(a.result || a.err)})`);
    if (!allowed.length) { console.log("info the hooks did not reach TEND from cursor-agent; nothing further can be checked here"); return; }
    check(ran(a, "tend-activity-test") || /tend-activity-test/.test(a.result), "and Cursor ran it");
    const s = await state();
    check(s.taskEvents.some((e) => e.agentId === agentId && e.type === "tool.called"), "the post-tool hook reported the run");
    check(!!s.agents.find((x) => x.id === agentId)?.lastSeenAt, "TEND saw the agent (session start)");

    console.log("\n-- blocked: the policy refuses it, and Cursor does not run it");
    const b = await cursor(ask("echo tend-blocked-test"));
    const blocked = await shell("echo tend-blocked-test");
    check(blocked.length >= 1 && blocked.every((x) => x.status === "denied"), `TEND refused it (${blocked.map((x) => x.status)})`);
    check(!ran(b, "tend-blocked-test"), `Cursor did not run it (${short(b.result)})`);

    console.log("\n-- approval: Cursor waits; a person approves in TEND; then it runs, once");
    const pending = cursor(ask("echo tend-approval-test"));
    const w = await waitFor(async () => (await shell("echo tend-approval-test")).find((x) => x.status === "pending"));
    check(!!w, "the request waits for a person");
    if (w) await decideOn(w.id, "approved");
    const c = await pending;
    check(/tend-approval-test/.test(c.result), `Cursor ran it after the approval (${short(c.result)})`);
    check((await shell("echo tend-approval-test")).find((x) => x.id === w?.id)?.status === "consumed", "the approval was spent once");

    console.log("\n-- rejection: a person says no; nothing runs");
    const rp = cursor(ask("echo tend-approval-test-two"));
    const w2 = await waitFor(async () => (await shell("echo tend-approval-test-two")).find((x) => x.status === "pending"));
    if (w2) await decideOn(w2.id, "rejected");
    const r = await rp;
    check(!!w2 && !ran(r, "tend-approval-test-two"), `rejected, and not run (${short(r.result)})`);

    console.log("\n-- a file write: can preToolUse stop it before it happens? (Cursor's documentation does not say)");
    const wp = cursor("Create a file named .env in the current directory containing exactly the line TEND_TEST=1. Then say done.");
    const fw = await waitFor(async () => (await auths((x) => x.tool === "file.write" && /\.env/.test(x.detail ?? ""))).find((x) => x.status === "pending"), 150_000);
    console.log(`info the write ${fw ? "waited for a person in TEND" : "did NOT come to TEND before running"}`);
    if (fw) await decideOn(fw.id, "rejected");
    await wp;
    const written = existsSync(path.join(project, ".env"));
    check(!!fw && !written, `a write to .env waits for a person and, rejected, is not written (asked: ${!!fw}; file exists: ${written})`);

    console.log("\n-- TEND unreachable: blocked, not let through");
    const cfgFile = path.join(tendHome, "cursor.json"), good = readFileSync(cfgFile, "utf8");
    writeFileSync(cfgFile, JSON.stringify({ ...JSON.parse(good), url: "http://127.0.0.1:9" }), { mode: 0o600 });
    const u = await cursor(ask("echo tend-unreachable-test"));
    writeFileSync(cfgFile, good, { mode: 0o600 });
    check(!ran(u, "tend-unreachable-test"), `not run (${short(u.result)})`);

    console.log("\n-- a revoked key is blocked");
    await call("DELETE", `/api/v1/agents/${agentId}/keys`, { cookie });
    const v = await cursor(ask("echo tend-revoked-test"));
    check(!ran(v, "tend-revoked-test"), `not run with a revoked key (${short(v.result)})`);
  } finally {
    await server.stop();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
