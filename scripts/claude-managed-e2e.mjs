#!/usr/bin/env node
// Real Claude Code behind TEND's MANAGED hooks (npm run e2e:claude-managed). Needs the `claude` command signed in (a few short `claude -p` runs with
// the Haiku model, a few cents), administrator rights, and the explicit opt-in TEND_E2E_MANAGED=1, because it writes Claude Code's organization
// settings folder (/etc/claude-code on Linux) and removes it again. Refuses to run if that folder already exists. Use a disposable machine or container.
//
// What it shows, against the real thing: hooks installed per project can be switched off by the repository (disableAllHooks) or by a flag
// (--setting-sources user). Hooks installed with `tend-hooks.mjs install claude-code --managed` survive both, a --settings file, bypass-permissions
// mode and another config folder, and still block when TEND is gone. It also records what it could NOT show (--bare needs API-key login).
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startIsolatedServer } from "./isolated-server.mjs";
import { presetRules } from "../src/lib/agent-presets.ts";

const root = path.resolve(import.meta.dirname, "..");
const MANAGED = "/etc/claude-code";
if (process.env.TEND_E2E_MANAGED !== "1") { console.log("SKIP set TEND_E2E_MANAGED=1 to run (it writes /etc/claude-code, as root, and removes it again)"); process.exit(0); }
if (process.platform !== "linux" || typeof process.getuid !== "function" || process.getuid() !== 0) { console.log("SKIP needs Linux and root"); process.exit(0); }
if (spawnSync("claude", ["--version"], { encoding: "utf8" }).status !== 0) { console.log("SKIP claude is not installed"); process.exit(0); }
if (existsSync(MANAGED)) { console.log(`REFUSING ${MANAGED} already exists; not touching an existing organization policy`); process.exit(2); }
const dir = mkdtempSync(path.join(tmpdir(), "tend-claude-managed-"));
const project = path.join(dir, "project");
let passed = 0, failed = 0;
const check = (ok, text) => { if (ok) passed++; else failed++; console.log(`${ok ? "ok  " : "FAIL"} ${text}`); };
const short = (s) => String(s).slice(0, 110).replace(/\n/g, " ");
const claude = (prompt, extra = [], env = {}) => new Promise((resolve) => {
  const child = spawn("claude", ["-p", prompt, "--model", "haiku", "--allowedTools", "Bash", "--max-turns", "4", "--output-format", "json", ...extra], { cwd: project, env: { ...process.env, TEND_URL: "", TEND_AGENT_KEY: "", ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let out = ""; child.stdout.on("data", (b) => (out += b));
  const t = setTimeout(() => child.kill("SIGTERM"), 200_000);
  child.on("close", () => { clearTimeout(t); let r = ""; try { r = JSON.parse(out).result ?? ""; } catch { r = out; } resolve(r); });
});
const ask = (n, cmd = "echo") => `Use the Bash tool to run exactly this command, once, and then tell me its output: ${cmd} ${n} > ${n}.txt`;
const ran = (n) => { const f = path.join(project, `${n}.txt`); const d = existsSync(f); rmSync(f, { force: true }); return d; };
const hooks = (...a) => spawnSync(process.execPath, [path.join(root, "public/sdk/tend-hooks.mjs"), ...a], { env: { ...process.env, TEND_AGENT_KEY: key }, encoding: "utf8" });
let key = "";
async function main() {
  mkdirSync(path.join(project, ".claude"), { recursive: true });
  console.log(`Claude Code ${spawnSync("claude", ["--version"], { encoding: "utf8" }).stdout.trim()}`);
  const server = await startIsolatedServer({ root, env: { TEND_ADMIN_TOKEN: `e2e_admin_${randomBytes(20).toString("hex")}`, TEND_ADMIN: "0", TEND_EMAIL_VERIFICATION: "0", TEND_DATA_DIR: path.join(dir, "data") } });
  const call = async (m, p, { body, cookie } = {}) => { const r = await fetch(server.url + p, { method: m, headers: { ...(body && { "content-type": "application/json" }), ...(cookie && { cookie }) }, body: body && JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null), cookie: r.headers.get("set-cookie")?.split(";")[0] }; };
  let stopped = false;
  try {
    const pw = "correct horse battery staple";
    await call("POST", "/api/account/register", { body: { email: "owner@example.com", password: pw } });
    const cookie = (await call("POST", "/api/account/sign-in", { body: { email: "owner@example.com", password: pw } })).cookie;
    const reg = (await call("POST", "/api/v1/agents", { cookie, body: { name: "Claude Code (managed)", model: "Claude Code", provider: "Anthropic" } })).body;
    key = reg.apiKey;
    const pol = await call("GET", `/api/v1/agents/${reg.agent.id}/policy`, { cookie });
    await call("POST", `/api/v1/agents/${reg.agent.id}/policy`, { cookie, body: { rules: presetRules("balanced", 1), /* v1 on purpose: this suite needs an allowed command that writes a file (its control); Balanced v2 asks before any write, which claude-hooks-e2e and agent-presets.test.ts cover */ enforcement: "enforce", expectedVersion: pol.body.version } });
    const BLOCKED = "tend-blocked-test", ALLOWED = "tend-control-test";

    console.log("\n-- install --managed (real installer, run as root)");
    const refuse = spawnSync(process.execPath, [path.join(root, "public/sdk/tend-hooks.mjs"), "install", "claude-code", "--managed", "--project", project, "--url", server.url, "--yes"], { env: { ...process.env, TEND_AGENT_KEY: key }, encoding: "utf8" });
    check(refuse.status !== 0 && !existsSync(MANAGED), "--managed with --project is refused and writes nothing");
    const inst = hooks("install", "claude-code", "--managed", "--url", server.url, "--yes");
    check(inst.status === 0, `managed install succeeded (${inst.status}) ${short(inst.stderr.split("\n").find((l) => /Done|refus|cannot/i.test(l)) ?? "")}`);
    const st = (p) => lstatSync(p);
    const rootOnly = (p) => st(p).uid === 0 && (st(p).mode & 0o022) === 0;
    check(rootOnly(MANAGED) && rootOnly(path.join(MANAGED, "tend")) && rootOnly(path.join(MANAGED, "managed-settings.json")) && rootOnly(path.join(MANAGED, "tend/tend-hooks.mjs")), "the folder, the settings, the script are root-owned and not writable by anyone else");
    check((st(path.join(MANAGED, "tend/claude-code.json")).mode & 0o037) === 0 && st(path.join(MANAGED, "tend/claude-code.json")).uid === 0, "the key file is root-owned, not group-writable, not readable by others");
    const status = hooks("status", "claude-code", "--managed");
    check(status.status === 0 && /in place/.test(status.stdout), `status says managed enforcement is in place (${short(status.stdout)})`);

    console.log("\n-- real Claude Code, hooks only in the managed settings (the project has none)");
    check(ran(ALLOWED) === false && (await claude(ask(ALLOWED)), ran(ALLOWED)), "control: an allowed command runs and leaves its file");
    check(!(await claude(ask(BLOCKED)), ran(BLOCKED)), "a command the policy denies does not run");

    console.log("\n-- the ways around project-level hooks, against managed hooks");
    writeFileSync(path.join(project, ".claude/settings.json"), JSON.stringify({ disableAllHooks: true }));
    await claude(ask(BLOCKED)); check(!ran(BLOCKED), "the repository's own settings say disableAllHooks: still blocked");
    writeFileSync(path.join(project, ".claude/settings.json"), "{}");
    await claude(ask(BLOCKED), ["--setting-sources", "user"]); check(!ran(BLOCKED), "--setting-sources user (leaves out project settings): still blocked");
    const evil = path.join(dir, "evil-settings.json"); writeFileSync(evil, JSON.stringify({ disableAllHooks: true }));
    await claude(ask(BLOCKED), ["--settings", evil]); check(!ran(BLOCKED), "--settings with disableAllHooks: still blocked");
    await claude(ask(BLOCKED), ["--dangerously-skip-permissions"]); check(!ran(BLOCKED), "--dangerously-skip-permissions: still blocked");
    await claude(ask(BLOCKED), ["--permission-mode", "bypassPermissions"]); check(!ran(BLOCKED), "bypassPermissions mode: still blocked");
    await claude(ask(BLOCKED), [], { CLAUDE_CONFIG_DIR: path.join(dir, "other-config") }); check(!ran(BLOCKED), "another CLAUDE_CONFIG_DIR: still blocked");

    console.log("\n-- TEND goes away: the managed hook blocks even a command the policy allows");
    await server.stop(); stopped = true;
    await claude(ask(ALLOWED)); check(!ran(ALLOWED), "TEND unreachable: nothing runs");

    console.log("\n-- uninstall --managed");
    const un = hooks("uninstall", "claude-code", "--managed", "--yes");
    check(un.status === 0 && !existsSync(path.join(MANAGED, "managed-settings.json")) && !existsSync(path.join(MANAGED, "tend/claude-code.json")), "uninstall removes the managed settings and the key file");
    console.log("info --bare was not tested: it skips keychain/OAuth login, so a subscription login cannot run in it. Claude Code's help says managed PLUGINS' hooks are unaffected by --bare, settings hooks are skipped. Treat --bare as a bypass until tested with API-key login.");
  } finally {
    if (!stopped) await server.stop();
    rmSync(MANAGED, { recursive: true, force: true });
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
  }
}
main().catch((e) => { rmSync(MANAGED, { recursive: true, force: true }); console.error(e); process.exit(1); });
