// The real hooks adapter (examples/hooks/tend-hooks.mjs: the code Claude Code runs before every tool call) against a throwaway TEND server.
// When TEND is unreachable, goes away mid-approval, or the input is unreadable, the tool call must be BLOCKED, never let through.
// Harmless Bash input only; nothing is executed by this script.
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { startIsolatedServer } from "../../scripts/isolated-server.mjs";
import { runHook } from "../../examples/hooks/tend-hooks.mjs";
import { record } from "./lib.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const work = mkdtempSync(path.join(tmpdir(), "tend-failclosed-"));
const project = path.join(work, "project"), home = path.join(work, "home");
mkdirSync(project, { recursive: true });
const ADMIN = `rt_admin_${randomBytes(24).toString("hex")}`;
const server = await startIsolatedServer({ root, env: { TEND_ADMIN_TOKEN: ADMIN, TEND_DATA_DIR: path.join(work, "data") } });
const api = async (m, p, { body, cookie } = {}) => { const r = await fetch(server.url + p, { method: m, headers: { ...(body && { "content-type": "application/json" }), ...(cookie && { cookie }) }, body: body && JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null), cookie: r.headers.get("set-cookie")?.split(";")[0] }; };
const input = (command, id) => ({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, tool_use_id: id, session_id: "s1", cwd: project });
const ask = async (cfg, command, id, opts = {}) => { let out = ""; await runHook("claude-code", input(command, id), { cfg, out: (s) => (out += s), role: "pre", pollMs: 100, waitMs: 4000, ...opts }); let j; try { j = JSON.parse(out); } catch {} return { out: out.slice(0, 160), denied: j?.hookSpecificOutput?.permissionDecision === "deny", silent: out === "" }; };
try {
  const cookie = (await api("POST", "/api/operator/session", { body: { token: ADMIN } })).cookie;
  const reg = (await api("POST", "/api/v1/agents", { cookie, body: { name: "Hook probe", model: "m", provider: "Anthropic" } })).body;
  await api("POST", `/api/v1/agents/${reg.agent.id}/policy`, { cookie, body: { enforcement: "enforce", rules: [{ tool: "shell", action: "Bash", effect: "allow", when: { command: { startsWith: "echo ok" } } }, { tool: "shell", action: "Bash", effect: "approve" }] } });
  const cfg = { url: server.url, key: reg.apiKey };

  const control = await ask(cfg, "echo ok control", "t1");
  record("HK-0", "control", "TEND up, policy allows: the hook lets the call through (no deny)", control.silent && !control.denied ? "HELD" : "BROKEN", JSON.stringify(control));
  const refused = await ask(cfg, "echo not allowed by startsWith", "t2", { waitMs: 800 });
  record("HK-1", "control", "TEND up, call needs a person and nobody answers: blocked at the deadline", refused.denied ? "HELD" : "BROKEN", JSON.stringify(refused));

  // approval pending, then TEND disappears: the hook must not turn that into a yes
  const pending = ask(cfg, "echo needs a person", "t3", { waitMs: 6000 });
  await new Promise((r) => setTimeout(r, 1500));
  await server.stop();
  const mid = await pending;
  record("HK-2", "fail-closed", "TEND stops while the hook waits for a person → blocked, nothing let through", mid.denied ? "HELD" : "BROKEN", JSON.stringify(mid));
  const down = await ask(cfg, "echo ok after outage", "t4");
  record("HK-3", "fail-closed", "TEND down: even a call the policy would allow is blocked (no cached allow)", down.denied ? "HELD" : "BROKEN", JSON.stringify(down));
  for (const [i, bad] of [null, {}, { tool_name: "" }, { hook_event_name: "PreToolUse" }, { tool_name: 5 }].entries()) {
    let out = ""; await runHook("claude-code", bad, { cfg, out: (s) => (out += s), role: "pre", waitMs: 500, pollMs: 100 });
    record(`HK-4${i}`, "fail-closed", `unreadable hook input ${JSON.stringify(bad)} is blocked`, out.includes('"deny"') ? "HELD" : "BROKEN", out.slice(0, 100));
  }
  let noCfg = ""; await runHook("claude-code", input("echo hi", "t5"), { cfg: null, out: (s) => (noCfg += s), role: "pre" });
  record("HK-5", "fail-closed", "no agent key/config on the computer: before-tool hook blocks", noCfg.includes('"deny"') ? "HELD" : "BROKEN", noCfg.slice(0, 100));
  // the same through a separate process, the way the host runs it: stdin JSON, exit status
  const inst = spawnSync(process.execPath, [path.join(root, "examples/hooks/tend-hooks.mjs"), "hook", "claude-code", "pre"], { input: "{", encoding: "utf8", env: { ...process.env, TEND_HOME: home }, timeout: 30_000 });
  record("HK-6", "fail-closed", "as a real subprocess with garbage on stdin: blocks (deny on stdout or non-zero exit)", /deny/.test(inst.stdout) || inst.status !== 0 ? "HELD" : "BROKEN", `exit=${inst.status} out=${inst.stdout.slice(0, 100)}`);
} finally {
  await server.stop().catch(() => {});
}
