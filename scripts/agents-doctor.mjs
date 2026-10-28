#!/usr/bin/env node
// `npm run agents:doctor`: how exposed is this machine to a same-user bypass of the gateway? It looks at file permissions and
// configuration (never file contents, never a secret value) and says what to fix. It cannot see other users' processes, containers or
// what an agent was started with; it checks the setup, not the running agents.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { canConfine } from "./confine.mjs";
import { serverPaths } from "./server-paths.mjs";

const SERVER_ONLY = [/^TEND_GATEWAY_/, /^TEND_ADMIN_TOKEN$/, /^TEND_DATA_DIR$/, /^DATABASE_URL$/, /^POSTGRES_URL$/];
const mode = (p) => statSync(p).mode & 0o777;
const loose = (p) => (mode(p) & 0o077) !== 0; // readable or writable by group or others

/** @returns {{ level: "ok" | "warn" | "fail" | "info", text: string, fix?: string }[]} */
export function diagnose({ root, env = process.env, platform = process.platform, confinement = canConfine() } = {}) {
  const out = [];
  const add = (level, text, fix) => out.push({ level, text, ...(fix && { fix }) });
  const agentFile = path.join(root, ".env.agent"), localFile = path.join(root, ".env.local");

  // 1. Files that hold secrets
  const check = (bad, warnText, fix, okText) => (bad ? add("warn", warnText, fix) : add("ok", okText));
  if (existsSync(localFile)) check(loose(localFile), `.env.local is readable by other accounts (mode ${mode(localFile).toString(8)}); it holds the admin token.`, "chmod 600 .env.local", ".env.local is private to your account (it holds the admin token).");
  if (existsSync(agentFile)) {
    check(loose(agentFile), `.env.agent is readable by other accounts (mode ${mode(agentFile).toString(8)}); it holds agent keys.`, "chmod 600 .env.agent", ".env.agent is private to your account.");
    let names = [];
    try {
      names = Object.keys(parseEnv(readFileSync(agentFile, "utf8")));
    } catch {}
    const bad = names.filter((n) => SERVER_ONLY.some((re) => re.test(n)));
    if (bad.length) add("fail", `.env.agent holds server-only variables (${bad.join(", ")}). An agent must not have these.`, "Remove them from .env.agent; they belong in .env.local for the server.");
    else add("ok", ".env.agent holds no server-only variables.");
  } else add("info", ".env.agent does not exist yet.", "npm run agents:setup");

  // 2. The sandbox and database folders
  const { sandbox, data } = serverPaths(root, env);
  if (!sandbox) add("warn", "TEND_GATEWAY_SANDBOX_DIR is not set: the test file tools are off.", `echo "TEND_GATEWAY_SANDBOX_DIR=$PWD/.agent-sandbox" >> .env.local`);
  else if (!existsSync(sandbox)) add("warn", "The sandbox folder is set but does not exist.", "npm run agents:setup");
  else check(loose(sandbox), `The sandbox folder is accessible to other accounts (mode ${mode(sandbox).toString(8)}).`, "chmod 700 on the sandbox folder", "The sandbox folder is private to your account.");
  if (data && existsSync(data)) check(loose(data), `The embedded database folder is accessible to other accounts (mode ${mode(data).toString(8)}).`, "chmod 700 on it", "The embedded database folder is private to your account.");

  // 3. The unavoidable part, said plainly
  add("info", "Every process you run as this user, including an agent, can read all of the above by default. File modes only keep other accounts out.");
  if (confinement) add("ok", "OS confinement is available: run agents with `npm run agents:confined -- openai` (or anthropic) so the kernel refuses those reads.");
  else add("warn", `OS confinement is not available on ${platform}. Run agents as a different OS user, or in a container that does not mount the repository, sandbox or database folders.`);

  // 4. This shell
  const held = Object.keys(env).filter((k) => env[k] && SERVER_ONLY.some((re) => re.test(k)));
  if (held.length) add("warn", `This shell exports server-only variables (${held.join(", ")}). An agent started from it refuses to run, and any process started here can read them. Anything the server was started with this way is also visible to other processes of yours through the process list.`, "unset them here; keep them in .env.local");
  else add("ok", "This shell holds no server-only variables.");

  // 5. Git hygiene
  let ignore = "";
  try {
    ignore = readFileSync(path.join(root, ".gitignore"), "utf8");
  } catch {}
  for (const [name, pattern] of [[".env.agent", /^\.env\*/m], [".agent-sandbox", /^\.agent-sandbox\/?$/m]])
    if (pattern.test(ignore)) add("ok", `${name} is git-ignored.`);
    else add("fail", `${name} is not git-ignored.`, `add ${name} to .gitignore`);
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(import.meta.dirname, "..");
  const mark = { ok: "ok  ", warn: "WARN", fail: "FAIL", info: "info" };
  const findings = diagnose({ root });
  for (const f of findings) console.log(`${mark[f.level]} ${f.text}${f.fix ? `\n     fix: ${f.fix}` : ""}`);
  console.log(`\n${findings.filter((f) => f.level === "fail").length} failing, ${findings.filter((f) => f.level === "warn").length} warning(s).`);
  process.exit(findings.some((f) => f.level === "fail") ? 1 : 0);
}
