// An isolated TEND server for tests and try-outs: an embedded database in a temp folder, a throwaway admin token, and NOTHING of your configuration.
//
// Why a temp project folder: `next start` loads .env.local (and .env) from the project directory it runs in. Run from the repository root, a
// DATABASE_URL, TEND_* or other setting in YOUR .env.local silently reconfigures the "isolated" server (a DATABASE_URL makes it use that database
// instead of the temp one). So the server runs in a throwaway directory that links only the build (.next), public/, node_modules, package.json and
// next.config.ts, with no .env* file, and every setting TEND reads is also set explicitly (empty means off).
//
// It also checks what it started: the database must be the embedded one, and the process holding the port must be this server (not a stale
// one from an earlier run answering for it). stop() ends the whole process tree, including the renamed `next-server` child that a plain kill leaves behind.
import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, openSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildServerProfile, canConfine } from "./confine.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lines = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { stdio: ["ignore", "pipe", "ignore"] }).toString().split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
};
/** pid and all its descendants (this tree only). */
export const processTree = (pid) => [pid, ...lines("pgrep", ["-P", String(pid)]).map(Number).flatMap(processTree)];
/**
 * The processes listening on a TCP port. On Linux read from /proc: lsof (4.95) silently skips a process whose name contains a parenthesis,
 * and Next.js names its server "next-server (v…)", so lsof reported no listener at all. Elsewhere (macOS) lsof.
 */
export const listeners = (port) => {
  if (process.platform !== "linux") return lines("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]).map(Number);
  const hex = port.toString(16).toUpperCase().padStart(4, "0");
  const inodes = new Set();
  for (const f of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let rows = [];
    try { rows = readFileSync(f, "utf8").split("\n").slice(1); } catch { continue; }
    for (const r of rows) { const c = r.trim().split(/\s+/); if (c.length > 9 && c[1].endsWith(`:${hex}`) && c[3] === "0A") inodes.add(c[9]); } // 0A = LISTEN
  }
  if (!inodes.size) return [];
  const pids = [];
  for (const pid of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
    let fds = [];
    try { fds = readdirSync(`/proc/${pid}/fd`); } catch { continue; }
    if (fds.some((fd) => { try { const m = /^socket:\[(\d+)\]$/.exec(readlinkSync(`/proc/${pid}/fd/${fd}`)); return !!m && inodes.has(m[1]); } catch { return false; } })) pids.push(Number(pid));
  }
  return pids;
};

/** A free port chosen by the operating system, never one a stale server already holds. */
export const freePort = () => new Promise((resolve, reject) => {
  const s = createServer();
  s.once("error", reject);
  s.listen(0, "127.0.0.1", () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  });
});

/** Every setting TEND reads, set explicitly so no env file or inherited variable can change them. */
const BLANK = ["DATABASE_URL", "DATABASE_MIGRATE_URL", "TEND_CONTEXT_KEY", "TEND_DB_ALLOW_OWNER_LOGIN", "TEND_DB_STRICT", "POSTGRES_URL", "VERCEL", "TEND_TRUSTED_PROXY", "TEND_GATEWAY_NOTES_DIR", "TEND_GATEWAY_PAYMENTS_KEY"];

/**
 * @param root   repository root (needs a production build)
 * @param env    TEND_ADMIN_TOKEN, TEND_GATEWAY_SANDBOX_DIR, TEND_DATA_DIR, … for this server
* @param port   a fixed port (default: a free one chosen by the operating system)
 * @param confine  macOS only: { allowWrite: [dirs], hidden: [dirs] } runs the server under buildServerProfile (see confine.mjs); throws if unavailable, never runs unconfined
 * @param database  "embedded" (default: the temp database) or "postgres" (a rehearsal of a hosted instance: env.DATABASE_URL must point at a throwaway local PostgreSQL)
 */
/**
 * TEND_E2E_DATABASE_URL (a PostgreSQL superuser URL on THIS machine): every isolated server gets a fresh database there instead of the embedded
 * one, so the whole e2e suite runs against real PostgreSQL with row-level tenant isolation on (production default). Dropped when the server stops.
 */
async function freshPostgres(dataDir) {
  const base = process.env.TEND_E2E_DATABASE_URL;
  if (!base) return undefined;
  const u = new URL(base);
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(u.hostname)) throw new Error("TEND_E2E_DATABASE_URL must point at this machine");
  const pg = (await import("pg")).default;
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  // One database per data folder: a suite that restarts its server on the same folder ("the same database, restarted …") gets the same database.
  // Kept after stop() for that reason; they live only on the disposable local test cluster.
  const { createHash } = await import("node:crypto");
  const name = `tend_e2e_${createHash("sha256").update(String(dataDir ?? Math.random())).digest("hex").slice(0, 16)}`;
  if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rowCount) await admin.query(`CREATE DATABASE ${name}`);
  u.pathname = `/${name}`;
  // As production runs by default (docs/database-roles.md): the owner (here the superuser) only migrates, the application logs in as a
  // restricted login of its own, and the tenant context is signed. TEND_E2E_OWNER_LOGIN=1 runs the legacy single-owner-URL setup instead.
  if (process.env.TEND_E2E_OWNER_LOGIN === "1") return { env: { DATABASE_URL: u.toString(), TEND_DB_ALLOW_OWNER_LOGIN: "1" }, drop: async () => { await admin.end().catch(() => {}); } };
  const login = `${name}_app`;
  // A throwaway password per start (CI's PostgreSQL requires one over TCP); never printed, gone with the test cluster.
  const { randomBytes } = await import("node:crypto");
  const loginPw = randomBytes(24).toString("hex");
  if (!(await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [login])).rowCount) await admin.query(`CREATE ROLE ${login} LOGIN PASSWORD '${loginPw}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
  else await admin.query(`ALTER ROLE ${login} PASSWORD '${loginPw}'`);
  await admin.query(`GRANT CONNECT ON DATABASE ${name} TO ${login}`);
  const app = new URL(u); app.username = login; app.password = loginPw;
  return {
    env: { DATABASE_URL: app.toString(), DATABASE_MIGRATE_URL: u.toString(), TEND_CONTEXT_KEY: process.env.TEND_E2E_CONTEXT_KEY || randomBytes(32).toString("base64url") },
    drop: async () => { await admin.end().catch(() => {}); },
  };
}

export async function startIsolatedServer({ root, env, database = "embedded", port: wantedPort, confine, keepDir = false }) {
  const fresh = database === "embedded" ? await freshPostgres(env?.TEND_DATA_DIR) : undefined;
  if (fresh) { env = { ...env, ...fresh.env }; database = "postgres"; }
  if (!existsSync(path.join(root, ".next/BUILD_ID"))) throw new Error("There is no production build yet. Run `npm run build` first.");
  const dir = mkdtempSync(path.join(tmpdir(), "tend-isolated-"));
  for (const name of [".next", "node_modules", "package.json", "next.config.ts", "public"]) if (existsSync(path.join(root, name))) symlinkSync(path.join(root, name), path.join(dir, name));
  const port = wantedPort ?? (await freePort());
  const url = `http://127.0.0.1:${port}`;
  const nextArgs = ["start", "-p", String(port), "-H", "127.0.0.1"];
  const nextBin = path.join(root, "node_modules/.bin/next");
  if (confine && !canConfine()) throw new Error("Confinement needs macOS with /usr/bin/sandbox-exec. Not starting the server unconfined.");
  const [cmd, args] = confine ? ["/usr/bin/sandbox-exec", ["-p", buildServerProfile({ root, ...confine }), nextBin, ...nextArgs]] : [nextBin, nextArgs];
  // The server writes its output to a file, not a pipe: Node writes to pipes synchronously on Linux, so a server whose pipe the test does not
  // drain (a test busy in spawnSync, say) would block in console.warn once 64 KB wait, and its requests would hang.
  const logPath = path.join(dir, "server.log");
  const logFd = openSync(logPath, "a");
  const child = spawn(cmd, args, {
    cwd: dir, stdio: ["ignore", logFd, logFd],
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", TMPDIR: process.env.TMPDIR ?? "", LC_ALL: "C", NODE_ENV: "production", TEND_DEMO: "0", TEND_PUBLIC: "0", TEND_LOCAL_HTTP: "1", // a local server: lets Safari keep the sign-in cookie over http://127.0.0.1 (see src/server/session.ts)
     ...Object.fromEntries(BLANK.map((k) => [k, ""])), ...env },
  });
  closeSync(logFd); // the child has its own copy
  let kept = "";
  const read = () => { try { return (kept = readFileSync(logPath, "utf8")); } catch { return kept; } };
  const stop = async () => {
    read(); // kept for output() after the folder is gone
    const pids = processTree(child.pid);
    for (const p of pids) try { process.kill(p, "SIGTERM"); } catch {}
    await sleep(300);
    for (const p of pids) try { process.kill(p, "SIGKILL"); } catch {}
    if (!keepDir) rmSync(dir, { recursive: true, force: true });
    await fresh?.drop();
  };
  try {
    let health;
    for (let i = 0; ; i++) {
      if (child.exitCode !== null) throw new Error(`The isolated server exited: ${read().slice(-400)}`);
      if (i > 120) throw new Error(`The isolated server did not start within 60s: ${read().slice(-400)}`);
      health = await fetch(`${url}/api/health`).then((r) => (r.ok ? r.json() : null), () => null);
      if (health) break;
      await sleep(500);
    }
    if (health.storage !== (database === "postgres" ? "postgres" : "embedded")) throw new Error(`The isolated server is not using the expected ${database} database (storage: ${health.storage}). Something configured a different database; refusing to continue.`);
    const mine = new Set(processTree(child.pid));
    const holders = listeners(port);
    // Fail closed: a server that answered on this port but whose listener cannot be identified is not known to be ours.
    if (!holders.length) throw new Error(`Port ${port} answered, but no listening process could be identified, so it cannot be confirmed to be this server. Refusing to continue.`);
    const others = holders.filter((p) => !mine.has(p));
    if (others.length) throw new Error(`Port ${port} is held by another process (pid ${others.join(", ")}), not this server. Refusing to continue: it could be a stale server with a different database.`);
    return { url, port, dir, health, stop, output: read, pids: () => processTree(child.pid) };
  } catch (e) {
    await stop();
    throw e;
  }
}
