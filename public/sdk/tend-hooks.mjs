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
import { chmodSync, chownSync, closeSync, constants, copyFileSync, existsSync, fchmodSync, fchownSync, ftruncateSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const HOSTS = { "claude-code": "Claude Code", cursor: "Cursor" };
// TEND_HOME moves the key and state files for install, uninstall and status (tests use a throwaway folder). Run as a hook, the files are the
// ones next to this installed copy, whatever the environment says: a repository's settings can set environment variables for the assistant,
// and must not be able to point the hook at another key or another server.
const HOOK_MODE = process.argv[2] === "hook";
const HOME = HOOK_MODE ? path.dirname(fileURLToPath(import.meta.url)) : process.env.TEND_HOME ?? path.join(homedir(), ".tend");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- what a tool call is, in TEND's words ----------------------------------------------------------------------------

/** Kinds shared by every host, so one policy reads the same for Claude Code and Cursor. The host's own tool name is the action. */
export const KINDS = ["shell", "file.write", "file.read", "web", "mcp", "agent", "other"];
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
  if (/write|edit|delete|create_file|apply|patch|rename|move|replace|insert|remove/.test(t)) return "file.write";
  if (/read|grep|glob|search_files|list|find|ls/.test(t)) return "file.read";
  if (/web|fetch|http|browse/.test(t)) return "web";
  // Only the tools listed above count as the assistant's bookkeeping. A tool this file does not know is not assumed harmless.
  return "other";
}

// Things that look like credentials in a command or URL. Replaced before anything leaves this computer.
const SECRET = [
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}/g, /\btend_(?:sk|az)_[A-Za-z0-9_-]{12,}/g, /\bgh[pousr]_[A-Za-z0-9]{20,}/g, /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g, /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  // A value is replaced only when it is plain text: one with $, `, quotes, ;, |, &, <, >, ( or ) in it could run something, and is left visible.
  /\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS|PWD)[A-Z0-9_]*=)(?:"[^"$`\\]*"|'[^']*'|[^\s"'$`;|&<>()\\]+)(?![^\s;|&<>()'"])/gi,
  /(--?(?:password|passwd|token|secret|api[-_]?key)[= ])(?:"[^"$`\\]*"|'[^']*'|[^\s"'$`;|&<>()\\]+)(?![^\s;|&<>()'"])/gi,
  /(authorization:\s*(?:bearer|basic)\s+)[^\s"'$`;|&<>()\\]+(?![^\s;|&<>()'"])/gi, /(\/\/[^/\s:@]+:)[^@\s/$`;|&<>()\\]+(?=@)/g,
];
export function redact(text) {
  let out = String(text ?? "");
  // A pattern's first group, when it has one, is the part kept (the name and "=", the flag, "//user:").
  for (const re of SECRET) out = out.replace(re, (m, a) => (typeof a === "string" ? `${a}***` : "***"));
  return out;
}
// Printable one line: what a person reads when approving must look exactly like what it is (no control or invisible characters).
// Control, zero-width and bidirectional characters, as in TEND's own check (src/server/policy.ts), built from code points so this file holds none.
const INVISIBLE = new RegExp(`[${[[0x00, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x34f, 0x34f], [0x61c, 0x61c], [0x115f, 0x1160], [0x180e, 0x180e], [0x200b, 0x200f],
  [0x2028, 0x202e], [0x2060, 0x206f], [0x2800, 0x2800], [0x3164, 0x3164], [0xfeff, 0xfeff], [0xffa0, 0xffa0], [0xfff9, 0xfffb], [0xe0000, 0xe007f], [0xe0100, 0xe01ef]]
  .map(([a, b]) => `${String.fromCodePoint(a)}-${String.fromCodePoint(b)}`).join("")}]+`, "gu");
// A line break is shown as ⏎: "echo done" and a second command on the next line must not read as one harmless echo.
const flat = (s) => redact(s).replace(/\r?\n|\r/g, " ⏎ ").replace(INVISIBLE, " ").replace(/\s+/g, " ").trim();
// Cut to fit, and say so: a person must never take the start of a command for all of it.
const fit = (s, max) => {
  if (s.length <= max) return s;
  const more = (n) => `… (+${n} more characters)`, keep = max - more(s.length).length;
  return `${s.slice(0, keep).trimEnd()}${more(s.length - keep)}`;
};
const oneLine = (s, max) => fit(flat(s), max);
// What the rules test is never cut: a command, path or URL longer than this is not checked by halves, it is refused.
export const LIMITS = { command: 3000, path: 1000, url: 1000 };
const safeId = (s) => String(s ?? "").replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 64) || "unknown";

/** The authorization request TEND sees for one tool call. `args` are what policy conditions test (command, path, url, server). */
export function toRequest(tool, input = {}, cwd = "") {
  const kind = kindOf(tool);
  const i = input && typeof input === "object" ? input : {};
  const rel = (p) => (cwd && typeof p === "string" && p.startsWith(cwd + path.sep) ? p.slice(cwd.length + 1) : p);
  let args = {}, what = "", tooLong = 0;
  const whole = (s, max) => { const v = flat(s); if (v.length > max) tooLong = v.length; return v; };
  if (kind === "shell") { const command = whole(i.command ?? i.cmd ?? "", LIMITS.command); args = { command }; what = command; }
  else if (kind === "file.write" || kind === "file.read") {
    const p = i.file_path ?? i.path ?? i.notebook_path ?? i.target_file ?? i.pattern ?? "";
    args = { path: whole(p, LIMITS.path) }; what = flat(rel(p));
  } else if (kind === "web") { const url = whole(i.url ?? i.query ?? "", LIMITS.url); args = { url }; what = url; }
  else if (kind === "mcp") { args = { tool: oneLine(tool, 120) }; what = flat(tool); }
  const label = { shell: "Run", "file.write": "Change", "file.read": "Read", web: "Open", mcp: "Use", agent: "Use", other: "Use" }[kind];
  const request = { tool: kind, action: safeId(tool), detail: oneLine(what ? `${label}: ${what}` : `${label} ${tool}`, 200) || label, args };
  return tooLong ? { ...request, tooLong } : request;
}

// ---- talking to TEND -----------------------------------------------------------------------------------------------------

const configPath = (host) => path.join(HOME, `${host}.json`);
export function readConfig(host) {
  const envUrl = process.env.TEND_URL, envKey = process.env.TEND_AGENT_KEY;
  if (!HOOK_MODE && envUrl && envKey) return { url: envUrl.replace(/\/$/, ""), key: envKey };
  try {
    // Only a regular file (not a link to one) owned by you and readable by nobody else: the key decides what the assistant may do.
    const st = lstatSync(configPath(host));
    if (!st.isFile() || !(ownedByYou(st) || managedFile(st, lstatSync(HOME)))) return null;
    const c = JSON.parse(readFileSync(configPath(host), "utf8"));
    return { url: String(c.url).replace(/\/$/, ""), key: String(c.key) };
  } catch { return null; }
}
/** The agent key goes with every request: plain http only to this computer itself (an older install may have written another address). */
const keySafeUrl = (url) => { try { const u = new URL(url); return u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)); } catch { return false; } };

/** A key file you own that nobody else can read or write. */
const ownedByYou = (st) => (st.mode & 0o077) === 0 && (typeof process.getuid !== "function" || st.uid === process.getuid());
/**
 * A key file from a managed install (see "install --managed"): owned by root, readable by one group at most, writable by nobody but root, in a folder
 * that only root can change. The person (and the agent running as them) can read it but cannot point the hook at another server or key, and cannot
 * swap the hook script or the file, because replacing either needs write access to a folder they do not have.
 */
const managedFile = (st, dir) => typeof process.getuid === "function" && st.uid === 0 && (st.mode & 0o037) === 0 && dir.isDirectory() && dir.uid === 0 && (dir.mode & 0o022) === 0;

/**
 * The host's settings file, opened once and never through a symbolic link: it is read now and rewritten later through the same open file
 * (after the person confirms), so it cannot be swapped in between. A file that does not exist yet: no handle, created only when written.
 */
function openSettings(file) {
  try {
    const fd = openSync(file, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0));
    return { fd, text: readFileSync(fd, "utf8") };
  } catch (e) {
    if (e.code === "ENOENT") return { fd: undefined, text: "" };
    if (e.code === "ELOOP") fail(`${file} is a symbolic link; TEND does not write through links. Nothing was changed.`);
    throw e;
  }
}
/** Writes the settings through the file opened before (or as a new file that must not exist yet), keeping the text that was read as a backup. */
function writeSettings(file, opened, text, { mode = 0o644, owner, backup = true } = {}) {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  if (backup && opened.text) {
    const b = openSync(`${file}.before-tend`, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | noFollow, 0o600);
    try { writeSync(b, opened.text); } finally { closeSync(b); }
  }
  const fd = opened.fd ?? openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow, mode);
  try {
    ftruncateSync(fd, 0);
    writeSync(fd, text, 0);
    if (owner) fchownSync(fd, owner.uid, owner.gid);
    if (opened.fd === undefined || owner) fchmodSync(fd, mode);
  } finally { closeSync(fd); }
}

async function tend(cfg, p, body, headers = {}) {
  // Nothing (no key) goes over plain http to another computer, whatever the caller: a refusal here fails closed like an unreachable TEND.
  if (!keySafeUrl(cfg.url)) throw new Error("insecure TEND address");
  const res = await fetch(cfg.url + p, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${cfg.key}`, ...(body && { "content-type": "application/json" }), ...headers },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// A pre-tool hook remembers which authorization it used, so the post-tool hook (a separate process) can link the outcome to it.
// In a managed install the script's folder belongs to root and nobody else can write there, so the small per-call notes go to the user's own folder.
const stateDir = (host) => path.join(HOOK_MODE && (() => { try { return lstatSync(HOME).uid === 0 && typeof process.getuid === "function" && process.getuid() !== 0; } catch { return false; } })() ? path.join(homedir(), ".tend") : HOME, "state", host);
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
  if (!keySafeUrl(cfg.url)) return { allow: false, reason: "TEND's address on this computer is plain http to another machine, so the agent key would travel unencrypted. Nothing ran and nothing was sent. Install the hooks again with an https:// address." };
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
    const { tooLong, ...request } = toRequest(String(input.tool_name ?? "unknown"), input.tool_input, input.cwd ?? input.workspace_roots?.[0] ?? "");
    if (tooLong) return deny(`TEND blocked this: it is ${tooLong} characters long, more than TEND checks in full. Nothing ran. Split it into shorter steps.`);
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
export function plan(host, { project, managed } = {}) {
  const script = path.join(managed ? managed.home : HOME, "tend-hooks.mjs");
  const cmd = `node "${script}" hook ${host}`, pre = `${cmd} pre`;
  if (host === "claude-code") {
    const file = managed ? path.join(managed.dir, "managed-settings.json") : project ? path.join(project, ".claude", "settings.local.json") : path.join(homedir(), ".claude", "settings.json");
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

/**
 * Claude Code's organization-managed settings folder. Settings there outrank the user's and the repository's and cannot be switched off by them:
 * a repository's own `disableAllHooks`, the `--setting-sources user` flag, a `--settings` file, bypass-permissions mode and another config folder
 * were all tried against real Claude Code 2.1.327 (npm run e2e:claude-managed) and the managed hooks still ran. Needs administrator rights to write.
 */
export const managedDefaults = () => process.platform === "darwin" ? "/Library/Application Support/ClaudeCode" : process.platform === "win32" ? "C:\\Program Files\\ClaudeCode" : "/etc/claude-code";
const managedOf = () => {
  if (!process.argv.includes("--managed")) return undefined;
  const dir = path.resolve(arg("--managed-dir") ?? managedDefaults());
  return { dir, home: path.join(dir, "tend") };
};

async function install(host) {
  const managed = managedOf();
  if (managed && host !== "claude-code") fail("--managed is for Claude Code (Cursor has no organization-managed hooks that TEND has tested).");
  if (managed && typeof process.getuid === "function" && process.getuid() !== 0) fail(`--managed writes to ${managed.dir}, which only an administrator can change; that is the point (a repository or the person running Claude Code cannot undo it). Run it with administrator rights, for example: sudo -E node tend-hooks.mjs install claude-code --managed --url <TEND address> --yes   (TEND_AGENT_KEY must be set; -E keeps it). Nothing was changed.`);
  const project = arg("--project") ? path.resolve(arg("--project")) : undefined;
  if (managed && project) fail("--managed and --project cannot be combined.");
  const yes = process.argv.includes("--yes");
  const url = (arg("--url") ?? process.env.TEND_URL ?? "").replace(/\/$/, "");
  if (!/^https?:\/\/[A-Za-z0-9.:[\]-]+$/.test(url)) fail("Give TEND's address: --url https://your-tend.example");
  // The agent key travels with every tool call: plain http only to this computer itself, never across a network.
  if (url.startsWith("http://") && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) fail("TEND's address must start with https:// (plain http only for localhost). The agent key would otherwise cross the network unencrypted.");
  const key = process.env.TEND_AGENT_KEY || (process.stdin.isTTY ? await ask("Paste the agent key from TEND (it is not shown): ", { hidden: true }) : "");
  if (!/^tend_sk_[A-Za-z0-9_-]{24,64}$/.test(key)) fail("That is not a TEND agent key (it starts with tend_sk_). Copy it from TEND and run this again.");
  let check;
  try { check = await tend({ url, key }, "/api/v1/agent/inbox"); } catch { fail(`TEND is not reachable at ${url}. Check the address and your connection.`); }
  if (check.status !== 200) fail(`TEND did not accept this key (${check.status} ${check.body.error ?? ""}). Create a new key in TEND and run this again.`);

  if (host === "claude-code") checkClaudeVersion();
  const { file, hooks } = plan(host, { project, managed });
  const opened = openSettings(file);
  let current = {};
  if (opened.text) {
    try { current = JSON.parse(opened.text); } catch { fail(`${file} is not valid JSON. Fix or move it, then run this again; nothing was changed.`); }
  }
  console.error(`\nTEND will add hooks to ${file} so ${HOSTS[host]} asks TEND before each tool runs`);
  console.error(`(${Object.keys(hooks).join(", ")}). Your other settings stay as they are${opened.text ? `; a copy of the current file is kept next to it` : ""}.`);
  if (managed) {
    console.error(`MANAGED INSTALL: the hooks, this script and the key file go to ${managed.home}, owned by root. Claude Code treats ${file} as organization policy:`);
    console.error(`a repository's settings, a command-line flag or the person running Claude Code cannot turn the hooks off. "allowManagedHooksOnly" is set, so hooks from user`);
    console.error(`and project settings stop running (only managed hooks do). The key file is readable by group ${process.env.SUDO_GID ?? "0 (root only)"} and by nobody else.`);
  } else console.error(`The agent key goes to ${configPath(host)}, readable only by you.`);
  if (!yes && (!process.stdin.isTTY || !/^y(es)?$/i.test(await ask("Add the hooks? [y/N] ")))) fail("Nothing was changed.");

  if (managed) return installManaged(host, { managed, file, opened, hooks, current, url, key, check });
  mkdirSync(HOME, { recursive: true, mode: 0o700 });
  writeFileSync(configPath(host), JSON.stringify({ url, key }, null, 2) + "\n", { mode: 0o600 });
  chmodSync(configPath(host), 0o600);
  const self = fileURLToPath(import.meta.url);
  if (path.resolve(self) !== path.join(HOME, "tend-hooks.mjs")) copyFileSync(self, path.join(HOME, "tend-hooks.mjs"));
  mkdirSync(path.dirname(file), { recursive: true });
  writeSettings(file, opened, JSON.stringify(merge(host, current, hooks), null, 2) + "\n");
  console.error(`\nDone. TEND recognised this computer as "${check.body.agentId}".`);
  console.error(host === "claude-code" ? "Start (or restart) Claude Code; TEND sees it start and checks each tool call from now on." : "Restart Cursor; TEND checks each agent tool call from now on.");
  console.error(`To remove: node "${path.join(HOME, "tend-hooks.mjs")}" uninstall ${host}${project ? ` --project "${project}"` : ""}`);
}

/** The managed variant of install: root-owned folder, script and key file; the host's managed settings carry the hooks and allowManagedHooksOnly. */
function installManaged(host, { managed, file, opened, hooks, current, url, key, check }) {
  const gid = Number(process.env.SUDO_GID ?? 0);
  mkdirSync(managed.dir, { recursive: true, mode: 0o755 });
  mkdirSync(managed.home, { recursive: true, mode: 0o755 });
  for (const d of [managed.dir, managed.home]) { chownSync(d, 0, 0); chmodSync(d, 0o755); }
  const cfg = path.join(managed.home, `${host}.json`), script = path.join(managed.home, "tend-hooks.mjs");
  writeFileSync(cfg, JSON.stringify({ url, key }, null, 2) + "\n", { mode: 0o640 });
  chownSync(cfg, 0, gid); chmodSync(cfg, 0o640);
  copyFileSync(fileURLToPath(import.meta.url), script);
  chownSync(script, 0, 0); chmodSync(script, 0o755);
  writeSettings(file, opened, JSON.stringify({ ...merge(host, current, hooks), allowManagedHooksOnly: true }, null, 2) + "\n", { mode: 0o644, owner: { uid: 0, gid: 0 } });
  console.error(`\nDone. TEND recognised this computer as "${check.body.agentId}". Start (or restart) Claude Code.`);
  console.error(`Check it: node "${script}" status claude-code --managed     Remove: sudo node "${script}" uninstall claude-code --managed --yes`);
  console.error(`Not covered: Claude Code's --bare mode skips settings hooks (not tested here: it needs API-key login), and anyone with administrator rights can remove this.`);
}

async function uninstall(host) {
  const managed = managedOf();
  if (managed && typeof process.getuid === "function" && process.getuid() !== 0) fail("Removing a managed install needs administrator rights (run it with sudo). Nothing was changed.");
  const project = arg("--project") ? path.resolve(arg("--project")) : undefined;
  const { file } = plan(host, { project, managed });
  const opened = openSettings(file);
  if (opened.fd === undefined) return console.error(`Nothing to remove: ${file} does not exist.`);
  const current = JSON.parse(opened.text);
  if (!process.argv.includes("--yes") && (!process.stdin.isTTY || !/^y(es)?$/i.test(await ask(`Remove TEND's hooks from ${file}? [y/N] `)))) fail("Nothing was changed.");
  const rest = merge(host, current, {});
  if (managed) delete rest.allowManagedHooksOnly;
  if (managed && !Object.keys(rest).length) { closeSync(opened.fd); rmSync(file, { force: true }); } else writeSettings(file, opened, JSON.stringify(rest, null, 2) + "\n", { backup: false });
  rmSync(managed ? path.join(managed.home, `${host}.json`) : configPath(host), { force: true });
  if (managed) rmSync(path.join(managed.home, "tend-hooks.mjs"), { force: true });
  console.error(`Removed. ${HOSTS[host]} no longer asks TEND, and TEND will show it as not connected.`);
}

/** What a status check can say about managed enforcement without trusting it: is the policy there, and could the current user change it? */
export function managedStatus(host, dir) {
  const file = path.join(dir, "managed-settings.json"), home = path.join(dir, "tend");
  const out = { present: false, tendHooks: false, managedOnly: false, folderRootOnly: false, scriptRootOnly: false, keyFileTrusted: false, problems: [] };
  if (!existsSync(file)) { out.problems.push(`${file} does not exist: no managed enforcement on this computer.`); return out; }
  out.present = true;
  let s = {};
  try { s = JSON.parse(readFileSync(file, "utf8")); } catch { out.problems.push(`${file} is not valid JSON, so Claude Code cannot apply it.`); return out; }
  out.tendHooks = ours(s.hooks ?? {});
  out.managedOnly = s.allowManagedHooksOnly === true;
  if (s.disableAllHooks === true) out.problems.push("managed settings set disableAllHooks: true, so hooks are OFF.");
  if (!out.tendHooks) out.problems.push("the managed settings hold no TEND hook.");
  if (!out.managedOnly) out.problems.push("allowManagedHooksOnly is not set, so a repository can still switch hooks off with its own settings (not verified to be enough without it).");
  const root = (p) => { try { const st = lstatSync(p); return st.uid === 0 && (st.mode & 0o022) === 0; } catch { return false; } };
  out.folderRootOnly = root(dir) && root(home) && root(file);
  out.scriptRootOnly = root(path.join(home, "tend-hooks.mjs"));
  try { out.keyFileTrusted = managedFile(lstatSync(path.join(home, `${host}.json`)), lstatSync(home)); } catch {}
  if (!out.folderRootOnly) out.problems.push("the managed folder or file is writable by someone other than root, so it is not tamper-proof.");
  if (!out.scriptRootOnly) out.problems.push("the managed hook script is missing or writable by someone other than root.");
  if (!out.keyFileTrusted) out.problems.push("the managed key file is missing or not root-owned and write-protected: the hook will block every call.");
  return out;
}

async function status(host) {
  const managed = managedOf();
  if (managed) {
    const m = managedStatus(host, managed.dir);
    console.log(m.problems.length ? `Managed enforcement for ${HOSTS[host]} is NOT in order:\n- ${m.problems.join("\n- ")}` : `Managed enforcement for ${HOSTS[host]} is in place (${managed.dir}). It does not cover --bare mode or someone with administrator rights.`);
    process.exitCode = m.problems.length ? 1 : 0;
    return;
  }
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
