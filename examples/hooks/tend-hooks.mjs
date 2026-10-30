#!/usr/bin/env node
// TEND in front of Claude Code's and Cursor's own tools, through their documented hooks. One file, no dependencies, Node 18+.
//
//   node tend-hooks.mjs install claude-code [--project <dir>] [--url <TEND address>] [--yes]
//   node tend-hooks.mjs install cursor      [--project <dir>] [--url <TEND address>] [--yes]
//   node tend-hooks.mjs uninstall claude-code|cursor [--project <dir>] [--yes]
//   node tend-hooks.mjs status claude-code|cursor
//   node tend-hooks.mjs hook claude-code|cursor        (what the host runs; reads the hook's JSON on stdin)
//
// Before a tool runs, the host starts `hook`, which asks TEND (POST /api/v1/authorize, the same authorization every agent uses) whether this
// tool call may run. Allowed: the host's own permission rules then apply as usual. Needs a person: the hook waits while someone approves or
// rejects it in TEND, and only an approved request is spent (POST /authorizations/{id}/spend) and let through. Denied, rejected, expired, or
// TEND unreachable: the tool call is blocked. After a tool ran, the outcome is reported to TEND's activity log. Session start and end keep
// TEND's view of whether the assistant is running up to date.
//
// What this cannot do: it works only while the hooks are installed. Whoever controls the computer can remove them or start the assistant
// without them; TEND then sees nothing. Claude Code runs a hook that crashes or times out as blocked only because `onFailure: "block"` is set
// (Claude Code 2.1.295 or later); Cursor only with `failClosed: true`. Cursor does not document blocking file edits before they happen.
//
// The agent key is kept in ~/.tend/<host>.json (readable only by you), never in the host's settings, never printed, never sent anywhere but
// TEND. What TEND receives about a tool call: its kind, the tool's name, and a shortened copy of the command, path, URL or MCP tool, with
// things that look like secrets replaced by ***. Never file contents, prompts or tool output.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const HOSTS = { "claude-code": "Claude Code", cursor: "Cursor" };
// TEND_HOME moves the key and state files (tests use a throwaway folder).
const HOME = process.env.TEND_HOME ?? path.join(homedir(), ".tend");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- what a tool call is, in TEND's words ----------------------------------------------------------------------------

/** Kinds shared by every host, so one policy reads the same for Claude Code and Cursor. The host's own tool name is the action. */
export const KINDS = ["shell", "file.write", "file.read", "web", "mcp", "agent"];
const CLAUDE = {
  Bash: "shell", BashOutput: "shell", KillShell: "shell", KillBash: "shell", PowerShell: "shell",
  Write: "file.write", Edit: "file.write", MultiEdit: "file.write", NotebookEdit: "file.write",
  Read: "file.read", Glob: "file.read", Grep: "file.read", LS: "file.read", NotebookRead: "file.read",
  WebFetch: "web", WebSearch: "web", Monitor: "shell",
  // The assistant's own bookkeeping: no file, command or network access of their own.
  TodoWrite: "agent", Task: "agent", Agent: "agent", ExitPlanMode: "agent", AskUserQuestion: "agent", Skill: "agent", SlashCommand: "agent", ToolSearch: "agent",
};
export function kindOf(tool) {
  if (Object.hasOwn(CLAUDE, tool)) return CLAUDE[tool];
  if (/^mcp(__|:|_)/i.test(tool) || /mcp/i.test(tool)) return "mcp";
  const t = tool.toLowerCase();
  if (/shell|terminal|command|bash|exec/.test(t)) return "shell";
  if (/write|edit|delete|create_file|apply|patch|rename|move/.test(t)) return "file.write";
  if (/read|grep|glob|search_files|list|find|ls/.test(t)) return "file.read";
  if (/web|fetch|http|browse/.test(t)) return "web";
  return "agent";
}

// Things that look like credentials in a command or URL. Replaced before anything leaves this computer.
const SECRET = [
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}/g, /\btend_(?:sk|az)_[A-Za-z0-9_-]{12,}/g, /\bgh[pousr]_[A-Za-z0-9]{20,}/g, /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g, /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS|PWD)[A-Z0-9_]*=)(?:"[^"]*"|'[^']*'|\S+)/gi,
  /(--?(?:password|passwd|token|secret|api[-_]?key)[= ])(?:"[^"]*"|'[^']*'|\S+)/gi,
  /(authorization:\s*(?:bearer|basic)\s+)\S+/gi, /(\/\/[^/\s:@]+:)[^@\s/]+(?=@)/g,
];
export function redact(text) {
  let out = String(text ?? "");
  // A pattern's first group, when it has one, is the part kept (the name and "=", the flag, "//user:").
  for (const re of SECRET) out = out.replace(re, (m, a) => (typeof a === "string" ? `${a}***` : "***"));
  return out;
}
// Printable one line: what a person reads when approving must look exactly like what it is (no control or invisible characters).
// Control, zero-width and bidirectional characters, as in TEND's own check (src/server/policy.ts), built from code points so this file holds none.
const INVISIBLE = new RegExp(`[${[[0x00, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x61c, 0x61c], [0x180e, 0x180e], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff], [0xfff9, 0xfffb]]
  .map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`).join("")}]+`, "g");
const oneLine = (s, max) => redact(s).replace(INVISIBLE, " ").replace(/\s+/g, " ").trim().slice(0, max);
const safeId = (s) => String(s ?? "").replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 64) || "unknown";

/** The authorization request TEND sees for one tool call. `args` are what policy conditions test (command, path, url, server). */
export function toRequest(tool, input = {}, cwd = "") {
  const kind = kindOf(tool);
  const i = input && typeof input === "object" ? input : {};
  const rel = (p) => (cwd && typeof p === "string" && p.startsWith(cwd + path.sep) ? p.slice(cwd.length + 1) : p);
  let args = {}, what = "";
  if (kind === "shell") { const command = oneLine(i.command ?? i.cmd ?? "", 1000); args = { command }; what = command; }
  else if (kind === "file.write" || kind === "file.read") {
    const p = i.file_path ?? i.path ?? i.notebook_path ?? i.target_file ?? i.pattern ?? "";
    args = { path: oneLine(p, 500) }; what = oneLine(rel(p), 160);
  } else if (kind === "web") { const url = oneLine(i.url ?? i.query ?? "", 500); args = { url }; what = url; }
  else if (kind === "mcp") { args = { tool: oneLine(tool, 120) }; what = oneLine(tool, 160); }
  const label = { shell: "Run", "file.write": "Change", "file.read": "Read", web: "Open", mcp: "Use", agent: "Use" }[kind];
  return { tool: kind, action: safeId(tool), detail: oneLine(what ? `${label}: ${what}` : `${label} ${tool}`, 200) || label, args };
}

// ---- talking to TEND -----------------------------------------------------------------------------------------------------

const configPath = (host) => path.join(HOME, `${host}.json`);
export function readConfig(host) {
  const envUrl = process.env.TEND_URL, envKey = process.env.TEND_AGENT_KEY;
  if (envUrl && envKey) return { url: envUrl.replace(/\/$/, ""), key: envKey };
  try { const c = JSON.parse(readFileSync(configPath(host), "utf8")); return { url: String(c.url).replace(/\/$/, ""), key: String(c.key) }; } catch { return null; }
}

async function tend(cfg, p, body, headers = {}) {
  const res = await fetch(cfg.url + p, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${cfg.key}`, ...(body && { "content-type": "application/json" }), ...headers },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// A pre-tool hook remembers which authorization it used, so the post-tool hook (a separate process) can link the outcome to it.
const stateDir = (host) => path.join(HOME, "state", host);
function remember(host, toolUseId, authorizationId) {
  if (!toolUseId || !authorizationId) return;
  try { mkdirSync(stateDir(host), { recursive: true, mode: 0o700 }); writeFileSync(path.join(stateDir(host), safeId(toolUseId)), authorizationId, { mode: 0o600 }); } catch {}
}
function recall(host, toolUseId) {
  if (!toolUseId) return undefined;
  const f = path.join(stateDir(host), safeId(toolUseId));
  try { const id = readFileSync(f, "utf8").trim(); rmSync(f, { force: true }); return ID.test(id) ? id : undefined; } catch { return undefined; }
}
function sweepState(host) {
  try { for (const f of readdirSync(stateDir(host))) { const p = path.join(stateDir(host), f); if (Date.now() - statSync(p).mtimeMs > 86_400_000) rmSync(p, { force: true }); } } catch {}
}

/**
 * Asks TEND about one tool call and waits for a person if needed. Returns { allow: true, id } or { allow: false, reason }. Fails closed: any
 * answer that is not an explicit yes (a refusal, an error, TEND unreachable, nobody deciding in time) is a no.
 */
export async function decide(cfg, request, { idempotencyKey, waitMs = 540_000, pollMs = 2_000, onWait } = {}) {
  let r;
  try {
    r = await tend(cfg, "/api/v1/authorize", request, idempotencyKey && ID.test(idempotencyKey) ? { "idempotency-key": idempotencyKey } : {});
  } catch {
    return { allow: false, reason: `TEND is not reachable at ${cfg.url}, so this action was blocked. Nothing ran.` };
  }
  if (r.status === 200 && r.body.authorized === true) return { allow: true, id: r.body.id };
  if (r.status === 401) return { allow: false, reason: "TEND does not accept this agent key (revoked or replaced). Connect the assistant again from TEND." };
  if (r.status === 403) return { allow: false, reason: `TEND's policy does not allow this (${r.body.reason ?? r.body.error ?? "denied"}). Nothing ran.` };
  if (r.status !== 202 || typeof r.body.id !== "string") return { allow: false, reason: `TEND did not allow this (${r.status} ${r.body.error ?? ""}). Nothing ran.` };
  const id = r.body.id;
  onWait?.(id);
  for (const end = Date.now() + waitMs; Date.now() < end; await sleep(pollMs)) {
    let s;
    try { s = await tend(cfg, `/api/v1/authorizations/${id}`); } catch { continue; } // a blip while waiting: keep waiting until the deadline
    const status = s.body.status;
    if (s.status !== 200 || status === "pending") continue;
    if (status !== "approved") return { allow: false, reason: `A person ${status === "rejected" ? "rejected" : `did not approve (${status})`} this in TEND. Nothing ran.` };
    try {
      const spent = await tend(cfg, `/api/v1/authorizations/${id}/spend`, request);
      if (spent.status === 200 && spent.body.authorized === true) return { allow: true, id };
      return { allow: false, reason: `TEND did not confirm the approval (${spent.body.error ?? spent.status}). Nothing ran.` };
    } catch {
      return { allow: false, reason: `TEND became unreachable before the approval could be used. Nothing ran.` };
    }
  }
  return { allow: false, reason: "Nobody decided in TEND in time. Nothing ran." };
}

const report = (cfg, events) => tend(cfg, "/api/v1/events", { events }).catch(() => {});

// ---- the hook --------------------------------------------------------------------------------------------------------

const readStdin = async () => { let s = ""; for await (const c of process.stdin) s += c; return s; };

/** Claude Code: deny is a PreToolUse decision on stdout; "no output" lets Claude Code's own permission rules decide as usual. */
const claudeDeny = (reason) => JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } });

/**
 * `role` is "pre" when the host runs this as its before-tool hook (the installed command says so), so a call is treated as one to decide on
 * even if its input could not be read: then it is blocked. A silent before-tool hook would let the tool run.
 */
export async function runHook(host, input, { out = (s) => process.stdout.write(s), cfg = readConfig(host), waitMs, pollMs, role } = {}) {
  const event = input?.hook_event_name ?? "";
  const pre = role === "pre" || (host === "cursor" ? event === "preToolUse" : event === "PreToolUse");
  const deny = (reason) => out(host === "cursor" ? JSON.stringify({ permission: "deny", user_message: reason, agent_message: reason }) : claudeDeny(reason));
  if (!cfg) {
    if (pre) deny("TEND is not set up on this computer (no agent key). Nothing ran. Connect the assistant from TEND.");
    return;
  }
  if (pre) {
    if (!input || typeof input.tool_name !== "string" || !input.tool_name) return deny("TEND could not read this tool call, so it was blocked. Nothing ran.");
    sweepState(host);
    const request = toRequest(String(input.tool_name ?? "unknown"), input.tool_input, input.cwd ?? input.workspace_roots?.[0] ?? "");
    const r = await decide(cfg, request, { idempotencyKey: input.tool_use_id, waitMs, pollMs });
    if (!r.allow) return deny(r.reason);
    remember(host, input.tool_use_id, r.id);
    if (host === "cursor") out(JSON.stringify({ permission: "allow" }));
    return;
  }
  const session = safeId(input.session_id ?? input.conversation_id ?? "session");
  const name = HOSTS[host];
  if (event === "PostToolUse" || event === "postToolUse" || event === "postToolUseFailure") {
    const request = toRequest(String(input.tool_name ?? "unknown"), input.tool_input, input.cwd ?? "");
    const failed = event === "postToolUseFailure" || input.tool_response?.is_error === true || input.tool_response?.success === false;
    const id = recall(host, input.tool_use_id);
    await report(cfg, [{ type: "tool.called", data: { tool: request.tool, action: request.action, outcome: failed ? "failure" : "success", detail: request.detail, ...(id && { authorizationId: id }) } }]);
  } else if (event === "SessionStart" || event === "sessionStart") {
    await report(cfg, [{ type: "task.started", data: { taskId: session, title: `${name} session started` } }, { type: "agent.heartbeat" }]);
  } else if (event === "SessionEnd" || event === "sessionEnd") {
    await report(cfg, [{ type: "task.completed", data: { taskId: session, summary: `${name} session ended` } }, { type: "agent.disconnected", data: { reason: `${name} session ended` } }]);
  } else {
    await report(cfg, [{ type: "agent.heartbeat" }]); // Stop and anything else: still running
  }
}

// ---- installing ------------------------------------------------------------------------------------------------------

/** The host settings file this installs into, and the hook entries TEND adds. Entries are recognised by "tend-hooks.mjs" in their command. */
export function plan(host, { project } = {}) {
  const script = path.join(HOME, "tend-hooks.mjs");
  const cmd = `node "${script}" hook ${host}`, pre = `${cmd} pre`;
  if (host === "claude-code") {
    const file = project ? path.join(project, ".claude", "settings.local.json") : path.join(homedir(), ".claude", "settings.json");
    const h = (timeout, extra = {}) => [{ type: "command", command: cmd, timeout, ...extra }];
    return { file, hooks: {
      PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: pre, timeout: 600, onFailure: "block" }] }],
      PostToolUse: [{ matcher: "*", hooks: h(15) }],
      SessionStart: [{ hooks: h(15) }],
      SessionEnd: [{ hooks: h(5) }],
      Stop: [{ hooks: h(10) }],
    } };
  }
  const file = project ? path.join(project, ".cursor", "hooks.json") : path.join(homedir(), ".cursor", "hooks.json");
  const h = (timeout, extra = {}) => ({ command: cmd, timeout, ...extra });
  return { file, hooks: {
    preToolUse: [{ command: pre, timeout: 600, failClosed: true }],
    postToolUse: [h(15)], postToolUseFailure: [h(15)],
    sessionStart: [h(15)], sessionEnd: [h(5)], stop: [h(10)],
  } };
}

const ours = (entry) => JSON.stringify(entry).includes("tend-hooks.mjs");

/** The settings with TEND's entries replaced (or removed), everything else kept as it was. */
export function merge(host, settings, hooks) {
  const s = settings && typeof settings === "object" ? structuredClone(settings) : {};
  if (host === "cursor") s.version ??= 1;
  const all = s.hooks && typeof s.hooks === "object" ? s.hooks : {};
  for (const ev of Object.keys(all)) { all[ev] = (Array.isArray(all[ev]) ? all[ev] : []).filter((e) => !ours(e)); if (!all[ev].length) delete all[ev]; }
  for (const [ev, entries] of Object.entries(hooks ?? {})) all[ev] = [...(all[ev] ?? []), ...entries];
  if (Object.keys(all).length) s.hooks = all; else delete s.hooks;
  return s;
}

async function ask(question, { hidden = false } = {}) {
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  if (hidden) rl._writeToOutput = (s) => { if (s.includes(question)) process.stderr.write(s); };
  const answer = await new Promise((r) => rl.question(question, r));
  rl.close();
  if (hidden) process.stderr.write("\n");
  return answer.trim();
}

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };

async function install(host) {
  const project = arg("--project") ? path.resolve(arg("--project")) : undefined;
  const yes = process.argv.includes("--yes");
  const url = (arg("--url") ?? process.env.TEND_URL ?? "").replace(/\/$/, "");
  if (!/^https?:\/\/[A-Za-z0-9.:[\]-]+$/.test(url)) fail("Give TEND's address: --url https://your-tend.example");
  const key = process.env.TEND_AGENT_KEY || (process.stdin.isTTY ? await ask("Paste the agent key from TEND (it is not shown): ", { hidden: true }) : "");
  if (!/^tend_sk_[A-Za-z0-9_-]{24,64}$/.test(key)) fail("That is not a TEND agent key (it starts with tend_sk_). Copy it from TEND and run this again.");
  let check;
  try { check = await tend({ url, key }, "/api/v1/agent/inbox"); } catch { fail(`TEND is not reachable at ${url}. Check the address and your connection.`); }
  if (check.status !== 200) fail(`TEND did not accept this key (${check.status} ${check.body.error ?? ""}). Create a new key in TEND and run this again.`);

  if (host === "claude-code") checkClaudeVersion();
  const { file, hooks } = plan(host, { project });
  let current = {};
  if (existsSync(file)) {
    try { current = JSON.parse(readFileSync(file, "utf8")); } catch { fail(`${file} is not valid JSON. Fix or move it, then run this again; nothing was changed.`); }
  }
  console.error(`\nTEND will add hooks to ${file} so ${HOSTS[host]} asks TEND before each tool runs`);
  console.error(`(${Object.keys(hooks).join(", ")}). Your other settings stay as they are${existsSync(file) ? `; a copy of the current file is kept next to it` : ""}.`);
  console.error(`The agent key goes to ${configPath(host)}, readable only by you.`);
  if (!yes && (!process.stdin.isTTY || !/^y(es)?$/i.test(await ask("Add the hooks? [y/N] ")))) fail("Nothing was changed.");

  mkdirSync(HOME, { recursive: true, mode: 0o700 });
  writeFileSync(configPath(host), JSON.stringify({ url, key }, null, 2) + "\n", { mode: 0o600 });
  chmodSync(configPath(host), 0o600);
  const self = fileURLToPath(import.meta.url);
  if (path.resolve(self) !== path.join(HOME, "tend-hooks.mjs")) copyFileSync(self, path.join(HOME, "tend-hooks.mjs"));
  mkdirSync(path.dirname(file), { recursive: true });
  if (existsSync(file)) copyFileSync(file, `${file}.before-tend`);
  writeFileSync(file, JSON.stringify(merge(host, current, hooks), null, 2) + "\n");
  console.error(`\nDone. TEND recognised this computer as "${check.body.agentId}".`);
  console.error(host === "claude-code" ? "Start (or restart) Claude Code; TEND sees it start and checks each tool call from now on." : "Restart Cursor; TEND checks each agent tool call from now on.");
  console.error(`To remove: node "${path.join(HOME, "tend-hooks.mjs")}" uninstall ${host}${project ? ` --project "${project}"` : ""}`);
}

async function uninstall(host) {
  const project = arg("--project") ? path.resolve(arg("--project")) : undefined;
  const { file } = plan(host, { project });
  if (!existsSync(file)) return console.error(`Nothing to remove: ${file} does not exist.`);
  const current = JSON.parse(readFileSync(file, "utf8"));
  if (!process.argv.includes("--yes") && (!process.stdin.isTTY || !/^y(es)?$/i.test(await ask(`Remove TEND's hooks from ${file}? [y/N] `)))) fail("Nothing was changed.");
  writeFileSync(file, JSON.stringify(merge(host, current, {}), null, 2) + "\n");
  rmSync(configPath(host), { force: true });
  console.error(`Removed. ${HOSTS[host]} no longer asks TEND, and TEND will show it as not connected.`);
}

async function status(host) {
  const cfg = readConfig(host);
  if (!cfg) return console.log(`${HOSTS[host]}: not connected to TEND on this computer.`);
  try {
    const r = await tend(cfg, "/api/v1/agent/inbox");
    console.log(r.status === 200 ? `${HOSTS[host]}: connected to ${cfg.url} as "${r.body.agentId}".` : `${HOSTS[host]}: TEND refused the key (${r.status}).`);
  } catch { console.log(`${HOSTS[host]}: TEND is not reachable at ${cfg.url}.`); }
}

function fail(message) { console.error(message); process.exit(1); }

/**
 * Claude Code blocks a tool when TEND's hook crashes or times out only from 2.1.295 on (`onFailure: "block"`); before that a failing hook lets
 * the tool run. So an older Claude Code is refused rather than installed into with a silent hole.
 */
export const MIN_CLAUDE = [2, 1, 295];
export function claudeTooOld(versionText) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(versionText ?? ""));
  if (!m) return null;
  const v = m.slice(1).map(Number);
  for (let i = 0; i < 3; i++) if (v[i] !== MIN_CLAUDE[i]) return v[i] < MIN_CLAUDE[i];
  return false;
}
function checkClaudeVersion() {
  const r = spawnSync("claude", ["--version"], { encoding: "utf8", timeout: 15_000 });
  const old = r.status === 0 ? claudeTooOld(r.stdout) : null;
  if (old) fail(`Claude Code ${r.stdout.trim()} is too old: TEND needs ${MIN_CLAUDE.join(".")} or newer, so that a failing hook blocks the tool instead of letting it run. Update Claude Code (claude update), then run this again. Nothing was changed.`);
  if (old === null) console.error(`Could not check Claude Code's version. TEND needs ${MIN_CLAUDE.join(".")} or newer for a failing hook to block the tool.`);
}

// Run as a command, compared by real path: a folder reached through a symlink (macOS's /var is /private/var) is still this file. A wrong
// "not me" here would make the hook exit silently, and a silent PreToolUse hook lets the tool run.
const isMain = () => { try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (isMain()) {
  const [cmd, host] = process.argv.slice(2);
  if (Number(process.versions.node.split(".")[0]) < 18) fail("Node 18 or newer is needed.");
  if (!Object.hasOwn(HOSTS, host ?? "")) fail("Usage: node tend-hooks.mjs install|uninstall|status|hook claude-code|cursor [--project <dir>] [--url <address>]");
  if (cmd === "hook") {
    const role = process.argv[4] === "pre" ? "pre" : undefined;
    let input = null;
    try { input = JSON.parse(await readStdin()); } catch {}
    const blocked = "TEND's hook failed, so this action was blocked.";
    try { await runHook(host, input ?? {}, { role }); }
    catch { if (role === "pre" || (input?.hook_event_name ?? "").toLowerCase() === "pretooluse") process.stdout.write(host === "cursor" ? JSON.stringify({ permission: "deny", user_message: blocked }) : claudeDeny(blocked)); }
  } else if (cmd === "install") await install(host);
  else if (cmd === "uninstall") await uninstall(host);
  else if (cmd === "status") await status(host);
  else fail("Usage: node tend-hooks.mjs install|uninstall|status|hook claude-code|cursor");
}
