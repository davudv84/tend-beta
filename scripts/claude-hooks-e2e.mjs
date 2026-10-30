// Real Claude Code behind TEND's hooks (npm run e2e:claude-hooks). Needs the `claude` command, signed in; it runs a few short `claude -p`
// sessions with the Haiku model (a few cents) in a throwaway project folder, against an isolated TEND server.
//
// Real: Claude Code and its model choosing to call Bash, Claude Code running TEND's PreToolUse/PostToolUse/SessionStart hooks, TEND's policy,
// approvals and audit log. Nothing here stands in for Claude Code. The hooks are installed with `tend-hooks.mjs install --project <tmp>`, so
// your own ~/.claude settings and ~/.tend are not touched (TEND_HOME points at the throwaway folder).
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startIsolatedServer } from "./isolated-server.mjs";
import { presetRules } from "../src/lib/agent-presets.ts";

const root = path.resolve(import.meta.dirname, "..");
const dir = mkdtempSync(path.join(tmpdir(), "tend-claude-hooks-"));
const project = path.join(dir, "project"), tendHome = path.join(dir, "tend-home");
let URL_ = "", passed = 0, failed = 0;
const check = (ok, text) => { if (ok) passed++; else failed++; console.log(`${ok ? "ok  " : "FAIL"} ${text}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, p, { body, cookie, key } = {}) {
  const res = await fetch(URL_ + p, { method, headers: { ...(body !== undefined && { "content-type": "application/json" }), ...(cookie && { cookie }), ...(key && { authorization: `Bearer ${key}` }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null), setCookie: res.headers.get("set-cookie") };
}

/** One Claude Code session in the project, asked to run exactly one harmless command. Resolves with its exit code and output. */
function claude(prompt, env = {}) {
  return new Promise((resolve) => {
    const child = spawn("claude", ["-p", prompt, "--model", "haiku", "--allowedTools", "Bash(echo:*)", "--max-turns", "4", "--output-format", "json"], {
      cwd: project, env: { ...process.env, TEND_HOME: tendHome, TEND_URL: "", TEND_AGENT_KEY: "", ...env }, stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "", err = "";
    child.stdout.on("data", (b) => (out += b));
    child.stderr.on("data", (b) => (err += b));
    const timer = setTimeout(() => child.kill("SIGTERM"), 240_000);
    child.on("close", (code) => { clearTimeout(timer); let result = ""; try { result = JSON.parse(out).result ?? ""; } catch { result = out; } resolve({ code, result, err }); });
  });
}
const ask = (cmd) => `Use the Bash tool to run exactly this command, once, and then tell me its output: ${cmd}`;

async function main() {
  if (spawnSync("claude", ["--version"], { encoding: "utf8" }).status !== 0) { console.log("SKIP claude is not installed"); process.exit(0); }
  console.log(`Claude Code ${spawnSync("claude", ["--version"], { encoding: "utf8" }).stdout.trim()}`);
  const server = await startIsolatedServer({ root, env: { TEND_ADMIN_TOKEN: `e2e_admin_${randomBytes(20).toString("hex")}`, TEND_ADMIN: "0", TEND_EMAIL_VERIFICATION: "0", TEND_DATA_DIR: path.join(dir, "data") } });
  URL_ = server.url;
  try {
    const pw = "correct horse battery staple";
    await call("POST", "/api/account/register", { body: { email: "owner@example.com", password: pw } });
    const cookie = (await call("POST", "/api/account/sign-in", { body: { email: "owner@example.com", password: pw } })).setCookie?.split(";")[0];
    const reg = await call("POST", "/api/v1/agents", { cookie, body: { name: "Claude Code", model: "Claude Code", provider: "Anthropic" } });
    const agentId = reg.body.agent.id, key = reg.body.apiKey;
    const pol = await call("GET", `/api/v1/agents/${agentId}/policy`, { cookie });
    const saved = await call("POST", `/api/v1/agents/${agentId}/policy`, { cookie, body: { rules: presetRules("balanced"), enforcement: "enforce", expectedVersion: pol.body.version } });
    check(saved.status === 200, `the Balanced preset is a valid policy (${saved.status})`);

    console.log("\n-- install into a throwaway project (your own settings are not touched)");
    const inst = spawnSync(process.execPath, [path.join(root, "public/sdk/tend-hooks.mjs"), "install", "claude-code", "--project", project, "--url", URL_, "--yes"],
      { env: { ...process.env, TEND_HOME: tendHome, TEND_AGENT_KEY: key }, encoding: "utf8" });
    check(inst.status === 0, `install succeeded (${inst.status}) ${inst.status ? inst.stderr : ""}`);
    const settings = JSON.parse(readFileSync(path.join(project, ".claude/settings.local.json"), "utf8"));
    check(settings.hooks?.PreToolUse?.[0]?.hooks?.[0]?.onFailure === "block", "PreToolUse is installed with onFailure: block");
    check(!JSON.stringify(settings).includes("tend_sk_") && !inst.stderr.includes(key), "the key is not in the host's settings or the installer's output");
    check((readFileSync(path.join(tendHome, "claude-code.json"), "utf8").includes(key)), "the key is in TEND's own file instead");
    const state = async () => (await call("GET", "/api/v1/state", { cookie })).body.projection;
    const shellAuths = async (prefix) => (await state()).authorizations.filter((a) => a.agentId === agentId && a.tool === "shell" && (a.detail ?? "").startsWith(`Run: ${prefix}`));

    console.log("\n-- allowed: Claude Code runs a harmless command; TEND records the request, the run and the session");
    const a = await claude(ask("echo tend-activity-test"));
    check(a.code === 0 && /tend-activity-test/.test(a.result), `Claude Code ran it (${a.code}): ${a.result.slice(0, 120).replace(/\n/g, " ")}`);
    const activity = await shellAuths("echo tend-activity-test");
    check(activity.length >= 1 && activity[0].status === "consumed", `TEND authorized it under the policy (${activity.map((x) => x.status)})`);
    let s = await state();
    check(s.taskEvents.some((e) => e.agentId === agentId && e.type === "tool.called" && e.outcome === "success" && e.authorizationId === activity[0]?.id), "the post-tool hook reported the outcome, linked to the authorization");
    check(s.taskEvents.some((e) => e.agentId === agentId && e.type === "task.started"), "the session start was reported");
    check(!!s.agents.find((x) => x.id === agentId)?.lastSeenAt, "TEND saw the agent");

    console.log("\n-- blocked: the policy refuses it, and Claude Code does not run it");
    const b = await claude(ask("echo tend-blocked-test"));
    const blocked = await shellAuths("echo tend-blocked-test");
    check(blocked.length >= 1 && blocked.every((x) => x.status === "denied"), `TEND refused every attempt (${blocked.map((x) => x.status)})`);
    s = await state();
    check(!s.taskEvents.some((e) => e.agentId === agentId && e.type === "tool.called" && blocked.some((x) => x.id === e.authorizationId)), "no run was reported for it");
    check(!/^tend-blocked-test$/m.test(b.result), `Claude Code did not show the command's output (${b.result.slice(0, 120).replace(/\n/g, " ")})`);

    console.log("\n-- approval: Claude Code waits; a person approves in TEND; then it runs, once");
    const pending = claude(ask("echo tend-approval-test"));
    let waiting;
    for (const end = Date.now() + 120_000; !waiting && Date.now() < end; await sleep(1000)) waiting = (await shellAuths("echo tend-approval-test")).find((x) => x.status === "pending");
    check(!!waiting, "the request waits for a person in TEND");
    if (waiting) {
      // Another workspace sees none of this, and cannot answer it.
      await call("POST", "/api/account/register", { body: { email: "other@example.com", password: pw } });
      const other = (await call("POST", "/api/account/sign-in", { body: { email: "other@example.com", password: pw } })).setCookie?.split(";")[0];
      const theirs = (await call("GET", "/api/v1/state", { cookie: other })).body.projection;
      check(!theirs.agents.some((x) => x.id === agentId) && !theirs.authorizations.some((x) => x.agentId === agentId), "another account sees neither the agent nor its requests");
      check((await call("POST", `/api/v1/reviews/${waiting.id}`, { cookie: other, body: { status: "approved" } })).status === 404, "and cannot approve its request");
      check((await call("GET", "/api/v1/notifications", { cookie: other })).body.items.length === 0, "and gets none of its notifications");
      const mine = (await call("GET", "/api/v1/notifications", { cookie })).body.items;
      check(mine.some((n) => n.kind === "approval" && !n.read && n.href === `/oversight?request=${waiting.id}`), "the owner has an in-app approval notification linking to the request");
      check((await call("POST", `/api/v1/reviews/${waiting.id}`, { cookie, body: { status: "approved" } })).status === 200, "approved through the normal review route");
    }
    const c = await pending;
    check(c.code === 0 && /tend-approval-test/.test(c.result), `Claude Code ran it after the approval (${c.result.slice(0, 120).replace(/\n/g, " ")})`);
    const approvedAuth = (await shellAuths("echo tend-approval-test")).find((x) => x.id === waiting?.id);
    check(approvedAuth?.status === "consumed", `the approval was spent once (${approvedAuth?.status})`);
    s = await state();
    check(s.taskEvents.some((e) => e.type === "tool.called" && e.authorizationId === waiting?.id && e.outcome === "success"), "and the run is in the activity log, linked to the approval");

    console.log("\n-- rejection: a person says no; nothing runs");
    const rejecting = claude(ask("echo tend-approval-test"));
    let second;
    for (const end = Date.now() + 120_000; !second && Date.now() < end; await sleep(1000)) second = (await shellAuths("echo tend-approval-test")).find((x) => x.status === "pending");
    if (second) await call("POST", `/api/v1/reviews/${second.id}`, { cookie, body: { status: "rejected" } });
    const r = await rejecting;
    check(!!second && !(await state()).taskEvents.some((e) => e.type === "tool.called" && e.authorizationId === second.id), `rejected, and no run was reported (${r.result.slice(0, 100).replace(/\n/g, " ")})`);

    console.log("\n-- TEND unreachable: the call is blocked, not let through");
    const u = await claude(ask("echo tend-unreachable-test"), { TEND_URL: "http://127.0.0.1:9", TEND_AGENT_KEY: key });
    check(!/^tend-unreachable-test$/m.test(u.result), `Claude Code did not run it (${u.result.slice(0, 140).replace(/\n/g, " ")})`);

    // Not tested here: Claude Code's bypass-permissions mode. Whether hooks still run in it is not established by this suite.
    console.log("\n-- a hook that crashes blocks the call (onFailure: block), it does not let it through");
    const file = path.join(project, ".claude/settings.local.json");
    const good = readFileSync(file, "utf8");
    const broken = JSON.parse(good);
    broken.hooks.PreToolUse[0].hooks[0].command = `${JSON.stringify(process.execPath)} -e "process.exit(3)"`;
    writeFileSync(file, JSON.stringify(broken));
    const crash = await claude(ask("echo tend-crash-test"));
    writeFileSync(file, good);
    check(!/^tend-crash-test$/m.test(crash.result), `not run when the hook crashed (${crash.result.slice(0, 120).replace(/\n/g, " ")})`);

    console.log("\n-- nothing secret left behind");
    const stateFiles = existsSync(path.join(tendHome, "state/claude-code")) ? readdirSync(path.join(tendHome, "state/claude-code")) : [];
    check(stateFiles.length === 0, `the hook's link files were cleaned up (${stateFiles.length})`);
    check(!server.output().includes(key), "the key never appears in the server's output");
  } finally {
    await server.stop();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
