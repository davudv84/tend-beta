// Operating-system confinement for an agent process on macOS (sandbox-exec). It closes the "same machine, same user" bypass that
// the gateway cannot: even if a model is talked into running `cat .env.local` or reading the sandbox folder, the kernel refuses.
//
// The agent may read: its own code (examples/), its dependencies (node_modules/), package.json and .env.agent (its keys).
// It may NOT read or write anything else in the repository (so no .env.local, no source, no embedded database, no .git), nor the
// sandbox and data folders wherever they are, nor your credential folders (~/.ssh, ~/.aws, ~/.gnupg, ~/.config, ~/.npmrc, Keychains),
// and it cannot look at other processes (`ps`). It may write only to temporary folders. Network access is NOT restricted: the agent
// must reach TEND and its provider, and restricting DNS and TLS destinations reliably is outside what this profile attempts.
//
// Limits: macOS only (sandbox-exec is deprecated by Apple but is what ships); it confines the process you start with it, so an agent
// started some other way is not confined; a denied read is refused, not hidden (the file's existence can still be probed). On Linux
// use a separate user or a container with none of these paths mounted.
import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
export const canConfine = () => process.platform === "darwin" && existsSync(SANDBOX_EXEC);

/** Credential locations under the home directory that an agent never needs. */
export const HOME_SECRETS = [".ssh", ".aws", ".gnupg", ".netrc", ".npmrc", ".config", ".docker", ".kube", ".git-credentials", "Library/Keychains"];

/** Real path where the file exists (sandbox rules match real paths: /tmp is /private/tmp), else the path as given. */
const real = (p) => {
  const abs = path.resolve(p);
  try {
    return realpathSync(abs);
  } catch {
    return abs;
  }
};
const q = (p) => {
  if (/["\\\n\r\0]/.test(p)) throw new Error("a path with a quote, backslash or newline cannot go into a sandbox rule");
  return `"${p}"`;
};

/**
 * @param root    the repository root: unreadable except the allowed parts below
 * @param hidden  further folders that must be unreadable and unwritable (the sandbox folder, the database folder)
 * @param home    the home directory whose credential folders are hidden
 * @param readable  parts of `root` the agent may read
 */
export function buildProfile({ root, hidden = [], home = os.homedir(), readable = ["examples", "node_modules", "package.json", ".env.agent"] }) {
  const r = real(root);
  const lines = [
    "(version 1)",
    "(allow default)",
    // nothing is writable except temporary folders
    "(deny file-write*)",
    '(allow file-write* (subpath "/private/tmp") (subpath "/private/var/folders") (literal "/dev/null") (literal "/dev/tty") (literal "/dev/dtracehelper"))',
    // the repository: closed, except what the agent needs to run (read only)
    `(deny file-read* file-write* (subpath ${q(r)}))`,
    `(allow file-read-metadata (literal ${q(r)}))`, // node resolves module paths with lstat, which needs the directory itself, not its contents
    `(allow file-read* ${readable.map((x) => `(subpath ${q(path.join(r, x))})`).join(" ")})`,
    // specific denials come last, so they win over every allowance above
    ...hidden.map((h) => `(deny file-read* file-write* (subpath ${q(real(h))}))`),
    ...HOME_SECRETS.map((s) => `(deny file-read* file-write* (subpath ${q(path.join(real(home), s))}))`),
    "(deny process-info* (target others))",
  ];
  return lines.join("\n");
}

/**
 * Profile for a long-running TEND SERVER that is reachable from the internet (a beta served from your own machine). It cannot write anywhere but
 * temp and its own data and sandbox folders, cannot read or write the other instances' folders, the repository's secrets (.env*, .git, beta-envs,
 * beta-data) or your credential folders, and cannot see other processes. Everything else stays readable: Node and Next need much of the system.
 * A compromised server then still cannot read your SSH keys or other projects' secrets, or plant files outside its own folders.
 */
export function buildServerProfile({ root, allowWrite = [], hidden = [], home = os.homedir() }) {
  const r = real(root);
  const secrets = [".git", "beta-envs", "beta-data", ".data", ".agent-sandbox"].map((x) => path.join(r, x));
  return [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    '(allow file-write* (subpath "/private/tmp") (subpath "/private/var/folders") (literal "/dev/null") (literal "/dev/tty") (literal "/dev/dtracehelper"))',
    // the repository is read-only whatever it is nested in (a temp folder is writable); only the build cache and this instance's own folders are writable
    `(deny file-write* (subpath ${q(r)}))`,
    `(allow file-write* (subpath ${q(path.join(r, ".next/cache"))}))`,
    ...allowWrite.map((d) => `(allow file-write* (subpath ${q(real(d))}))`),
    // specific denials last, so they win; an instance's own folders are re-allowed after the shared ones are hidden
    ...secrets.map((s) => `(deny file-read* file-write* (subpath ${q(s)}))`),
    ...[".env", ".env.local", ".env.agent", ".env.production"].map((f) => `(deny file-read* file-write* (literal ${q(path.join(r, f))}))`),
    ...hidden.map((h) => `(deny file-read* file-write* (subpath ${q(real(h))}))`),
    ...allowWrite.map((d) => `(allow file-read* file-write* (subpath ${q(real(d))}))`),
    // Node resolves a path with lstat on every parent folder (realpath). The parents of an instance's own folders get metadata-only access: the
    // folder's existence, never its listing or contents, so the other instances' names and files stay hidden.
    ...[...new Set(allowWrite.flatMap((d) => parents(real(d))))].map((a) => `(allow file-read-metadata (literal ${q(a)}))`),
    ...HOME_SECRETS.map((s) => `(deny file-read* file-write* (subpath ${q(path.join(real(home), s))}))`),
    "(deny process-info* (target others))",
  ].join("\n");
}

const parents = (p) => {
  const out = [];
  for (let a = path.dirname(p); a !== path.dirname(a); a = path.dirname(a)) out.push(a);
  return out;
};

/** Starts `argv` confined. Never falls back to running unconfined: if confinement is unavailable it throws. */
export function confinedSpawn(argv, { root, hidden, home, env, cwd = os.tmpdir(), stdio = "inherit" }) {
  if (!canConfine()) throw new Error("Confinement needs macOS with /usr/bin/sandbox-exec. Not running the agent unconfined; use a separate user or container on this system.");
  return spawn(SANDBOX_EXEC, ["-p", buildProfile({ root, hidden, home }), ...argv], { env, cwd, stdio });
}
