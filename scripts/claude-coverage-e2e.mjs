// Real Claude Code behind TEND's hooks, the cases e2e:claude-hooks does not cover (npm run e2e:claude-coverage). Needs the `claude` command,
// signed in; a few short `claude -p` sessions with the Haiku model (a few cents) in a throwaway project, against an isolated TEND server.
// Your own ~/.claude settings and ~/.tend are not touched (project install, TEND_HOME in the throwaway folder).
//
//   file tools        a Write to .env waits for a person and, rejected, leaves no file; an ordinary Write runs and is recorded
//   no reuse          an approval is spent once: the same command again asks again
//   pause, revoke     a paused agent and a revoked key are blocked, and a revoked key creates no request at all
//   uninstall         removes TEND's hooks and leaves the rest of the settings as they were
//   outside TEND      a project's own .claude/settings.json with disableAllHooks turns TEND off for that project (a known gap, shown here)
//   --expiry          (about 10 minutes) nobody answers: the hook gives up and blocks, the request expires, a late approval is refused
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startIsolatedServer } from "./isolated-server.mjs";
import { presetRules } from "../src/lib/agent-presets.ts";

const root = path.resolve(import.meta.dirname, "..");
const dir = mkdtempSync(path.join(tmpdir(), "tend-claude-coverage-"));
const project = path.join(dir, "project"), tendHome = path.join(dir, "tend-home");
const expiryOnly = process.argv.includes("--expiry");
let URL_ = "", passed = 0, failed = 0;
const check = (ok, text) => { if (ok) passed++; else failed++; console.log(`${ok ? "ok  " : "FAIL"} ${text}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (s) => String(s).slice(0, 120).replace(/\n/g, " ");

async function call(method, p, { body, cookie } = {}) {
  const res = await fetch(URL_ + p, { method, headers: { ...(body !== undefined && { "content-type": "application/json" }), ...(cookie && { cookie }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null), setCookie: res.headers.get("set-cookie") };
}

function claude(prompt, tools = "Bash", timeout = 240_000) {
  return new Promise((resolve) => {
    const child = spawn("claude", ["-p", prompt, "--model", "haiku", "--allowedTools", tools, "--max-turns", "4", "--output-format", "json"], {
      cwd: project, env: { ...process.env, TEND_HOME: tendHome, TEND_URL: "", TEND_AGENT_KEY: "" }, stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (b) => (out += b));
    const timer = setTimeout(() => child.kill("SIGTERM"), timeout);
    child.on("close", (code) => { clearTimeout(timer); let result = ""; try { result = JSON.parse(out).result ?? ""; } catch { result = out; } resolve({ code, result }); });
  });
}
// Whether a command ran is read from what it leaves behind, not from how the model words its answer: each test command writes a file named
// after it, and the check looks for that file (and removes it, so the same command can be tried again). Claude Code's own rules allow any
// Bash command here, so TEND's hook is the only thing that can stop one.
const ask = (cmd) => `Use the Bash tool to run exactly this command, once, and then tell me its output: ${cmd} > ${cmd.split(" ").at(-1)}.txt`;
const ran = (_r, marker) => { const f = path.join(project, `${marker}.txt`); const did = existsSync(f); rmSync(f, { force: true }); return did; };

async function main() {
  if (spawnSync("claude", ["--version"], { encoding: "utf8" }).status !== 0) { console.log("SKIP claude is not installed"); process.exit(0); }
  console.log(`Claude Code ${spawnSync("claude", ["--version"], { encoding: "utf8" }).stdout.trim()}`);
  mkdirSync(project, { recursive: true });
  const server = await startIsolatedServer({ root, env: { TEND_ADMIN_TOKEN: `e2e_admin_${randomBytes(20).toString("hex")}`, TEND_ADMIN: "0", TEND_EMAIL_VERIFICATION: "0", TEND_DATA_DIR: path.join(dir, "data") } });
  URL_ = server.url;
  try {
    const pw = "correct horse battery staple";
    await call("POST", "/api/account/register", { body: { email: "owner@example.com", password: pw } });
    const cookie = (await call("POST", "/api/account/sign-in", { body: { email: "owner@example.com", password: pw } })).setCookie?.split(";")[0];
    const reg = await call("POST", "/api/v1/agents", { cookie, body: { name: "Claude Code", model: "Claude Code", provider: "Anthropic" } });
    const agentId = reg.body.agent.id;
    let key = reg.body.apiKey;
    const pol = await call("GET", `/api/v1/agents/${agentId}/policy`, { cookie });
    await call("POST", `/api/v1/agents/${agentId}/policy`, { cookie, body: { rules: presetRules("balanced"), enforcement: "enforce", expectedVersion: pol.body.version } });
    const install = () => spawnSync(process.execPath, [path.join(root, "public/sdk/tend-hooks.mjs"), "install", "claude-code", "--project", project, "--url", URL_, "--yes"],
      { env: { ...process.env, TEND_HOME: tendHome, TEND_AGENT_KEY: key }, encoding: "utf8" });
    check(install().status === 0, "hooks installed into the throwaway project");
    const state = async () => (await call("GET", "/api/v1/state", { cookie })).body.projection;
    const auths = async (pred) => (await state()).authorizations.filter((a) => a.agentId === agentId && pred(a));
    const shell = (prefix) => auths((a) => a.tool === "shell" && (a.detail ?? "").startsWith(`Run: ${prefix}`));
    const waitFor = async (find, ms = 120_000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(1000)) { const x = await find(); if (x) return x; } };
    const decideOn = (id, status) => call("POST", `/api/v1/reviews/${id}`, { cookie, body: { status } });

    if (expiryOnly) {
      console.log("\n-- nobody answers: the hook blocks when it stops waiting, the request expires, a late approval is refused (about 10 minutes)");
      const run = claude(ask("echo tend-approval-test-expiry"), "Bash(echo:*)", 720_000);
      const waiting = await waitFor(async () => (await shell("echo tend-approval-test-expiry")).find((x) => x.status === "pending"));
      check(!!waiting, "the request waits for a person");
      const r = await run;
      check(!ran(r, "tend-approval-test-expiry"), `Claude Code did not run it once the hook stopped waiting (${short(r.result)})`);
      await sleep(Math.max(0, (waiting?.expiresAt ?? 0) - Date.now()) + 2_000);
      const late = await decideOn(waiting.id, "approved");
      check(late.status >= 400, `approving after it expired is refused (${late.status} ${late.body?.error ?? ""})`);
      const after = (await shell("echo tend-approval-test-expiry")).find((x) => x.id === waiting.id);
      check(after?.status === "expired", `the request is recorded as expired (${after?.status})`);
      check(!(await state()).taskEvents.some((e) => e.authorizationId === waiting.id && e.type === "tool.called"), "no run was reported for it");
      return;
    }

    console.log("\n-- control: an allowed command runs and leaves its file (so a missing file below means it did not run)");
    const ctl = await claude(ask("echo tend-control-test"));
    check(ran(ctl, "tend-control-test"), `the allowed command ran (${short(ctl.result)})`);

    console.log("\n-- file tools: a Write to .env waits for a person; rejected, the file is never created");
    const envRun = claude("Use the Write tool to create a file named .env in the current directory containing exactly the line TEND_TEST=1. Then say done.", "Write");
    const envReq = await waitFor(async () => (await auths((a) => a.tool === "file.write" && /\.env/.test(a.detail ?? a.resource ?? ""))).find((x) => x.status === "pending"));
    check(!!envReq, `the Write waits for a person in TEND (${envReq?.tool} · ${envReq?.action} · ${short(envReq?.detail ?? "")})`);
    if (envReq) check((await decideOn(envReq.id, "rejected")).status === 200, "a person rejects it");
    await envRun;
    check(!existsSync(path.join(project, ".env")), "no .env file was written");

    console.log("\n-- file tools: an ordinary Write runs under the policy and is recorded");
    const notes = await claude("Use the Write tool to create a file named notes.txt in the current directory containing exactly the line hello from tend. Then say done.", "Write");
    const notesAuth = (await auths((a) => a.tool === "file.write" && /notes\.txt/.test(a.detail ?? a.resource ?? "")))[0];
    check(existsSync(path.join(project, "notes.txt")) && notesAuth?.status === "consumed", `written, and TEND authorized it (${notesAuth?.status}; ${short(notes.result)})`);

    console.log("\n-- an approval is spent once: the same command again asks again");
    const first = claude(ask("echo tend-approval-test-reuse"));
    const w1 = await waitFor(async () => (await shell("echo tend-approval-test-reuse")).find((x) => x.status === "pending"));
    if (w1) await decideOn(w1.id, "approved");
    const r1 = await first;
    check(ran(r1, "tend-approval-test-reuse"), `ran once after the approval (${short(r1.result)})`);
    const second = claude(ask("echo tend-approval-test-reuse"));
    const w2 = await waitFor(async () => (await shell("echo tend-approval-test-reuse")).find((x) => x.status === "pending" && x.id !== w1?.id));
    check(!!w2 && w2.id !== w1?.id, "the second run is a new request waiting for a person, not the old approval");
    if (w2) await decideOn(w2.id, "rejected");
    const r2 = await second;
    check(!ran(r2, "tend-approval-test-reuse") && (await shell("echo tend-approval-test-reuse")).find((x) => x.id === w1?.id)?.status === "consumed", `the second run did not run; the first approval stays spent (${short(r2.result)})`);

    console.log("\n-- a paused agent is blocked");
    check((await call("POST", `/api/v1/agents/${agentId}/control`, { cookie, body: { action: "pause" } })).status === 200, "paused in TEND");
    const p = await claude(ask("echo tend-paused-test"));
    check(!ran(p, "tend-paused-test"), `not run while paused (${short(p.result)})`);
    await call("POST", `/api/v1/agents/${agentId}/control`, { cookie, body: { action: "resume" } });

    console.log("\n-- a revoked key is blocked, and asks nothing");
    check((await call("DELETE", `/api/v1/agents/${agentId}/keys`, { cookie })).status === 200, "key revoked in TEND");
    const v = await claude(ask("echo tend-revoked-test"));
    check(!ran(v, "tend-revoked-test"), `not run with a revoked key (${short(v.result)})`);
    check((await shell("echo tend-revoked-test")).length === 0, "no request was recorded for the revoked key");

    console.log("\n-- uninstall removes TEND's hooks and keeps the rest of the settings");
    const local = path.join(project, ".claude/settings.local.json");
    const withExtra = JSON.parse(readFileSync(local, "utf8"));
    withExtra.permissions = { allow: ["Bash(ls:*)"] };
    writeFileSync(local, JSON.stringify(withExtra, null, 2));
    const un = spawnSync(process.execPath, [path.join(root, "public/sdk/tend-hooks.mjs"), "uninstall", "claude-code", "--project", project, "--yes"], { env: { ...process.env, TEND_HOME: tendHome }, encoding: "utf8" });
    const afterUn = JSON.parse(readFileSync(local, "utf8"));
    check(un.status === 0 && !JSON.stringify(afterUn).includes("tend-hooks"), `no TEND hook left in the settings (${un.status})`);
    check(JSON.stringify(afterUn.permissions) === JSON.stringify({ allow: ["Bash(ls:*)"] }), "the person's own settings are untouched");

    console.log("\n-- outside TEND: a project's own settings can switch hooks off (known gap; shown, not fixed)");
    key = (await call("POST", `/api/v1/agents/${agentId}/keys`, { cookie })).body.apiKey;
    check(install().status === 0, "reinstalled with a new key");
    const control = await claude(ask("echo tend-blocked-test"));
    check(!ran(control, "tend-blocked-test"), "control: with hooks on, the blocked test command does not run");
    writeFileSync(path.join(project, ".claude/settings.json"), JSON.stringify({ disableAllHooks: true }));
    const before = (await auths(() => true)).length;
    const off = await claude(ask("echo tend-blocked-test"));
    const offRan = ran(off, "tend-blocked-test");
    console.log(`info disableAllHooks in the project's .claude/settings.json: the command ${offRan ? "RAN without TEND" : "did not run"}; TEND recorded ${(await auths(() => true)).length - before} new request(s); Claude Code said: ${short(off.result)}`);
    // The same, with a command TEND's policy would allow: does it run at all with the hooks switched off, and does TEND hear of it?
    const before2 = (await auths(() => true)).length;
    const off2 = await claude(ask("echo tend-hooks-off-test"));
    console.log(`info with hooks switched off, an allowed command ${ran(off2, "tend-hooks-off-test") ? "ran" : "did not run"}; TEND recorded ${(await auths(() => true)).length - before2} new request(s); Claude Code said: ${short(off2.result)}`);
    check(true, `recorded the outcome of the disableAllHooks case (ran: ${offRan})`);
  } finally {
    await server.stop();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
