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
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
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
export const listeners = (port) => lines("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]).map(Number);

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
const BLANK = ["DATABASE_URL", "POSTGRES_URL", "VERCEL", "TEND_TRUSTED_PROXY", "TEND_GATEWAY_NOTES_DIR", "TEND_GATEWAY_PAYMENTS_KEY"];

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
  return { url: u.toString(), drop: async () => { await admin.end().catch(() => {}); } };
}

export async function startIsolatedServer({ root, env, database = "embedded", port: wantedPort, confine, keepDir = false }) {
  const fresh = database === "embedded" ? await freshPostgres(env?.TEND_DATA_DIR) : undefined;
  if (fresh) { env = { ...env, DATABASE_URL: fresh.url }; database = "postgres"; }
  if (!existsSync(path.join(root, ".next/BUILD_ID"))) throw new Error("There is no production build yet. Run `npm run build` first.");
  const dir = mkdtempSync(path.join(tmpdir(), "tend-isolated-"));
  for (const name of [".next", "node_modules", "package.json", "next.config.ts", "public"]) if (existsSync(path.join(root, name))) symlinkSync(path.join(root, name), path.join(dir, name));
  const port = wantedPort ?? (await freePort());
  const url = `http://127.0.0.1:${port}`;
  const nextArgs = ["start", "-p", String(port), "-H", "127.0.0.1"];
  const nextBin = path.join(root, "node_modules/.bin/next");
  if (confine && !canConfine()) throw new Error("Confinement needs macOS with /usr/bin/sandbox-exec. Not starting the server unconfined.");
  const [cmd, args] = confine ? ["/usr/bin/sandbox-exec", ["-p", buildServerProfile({ root, ...confine }), nextBin, ...nextArgs]] : [nextBin, nextArgs];
  const child = spawn(cmd, args, {
    cwd: dir, stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", TMPDIR: process.env.TMPDIR ?? "", LC_ALL: "C", NODE_ENV: "production", TEND_DEMO: "0", TEND_PUBLIC: "0", TEND_LOCAL_HTTP: "1", // a local server: lets Safari keep the sign-in cookie over http://127.0.0.1 (see src/server/session.ts)
     ...Object.fromEntries(BLANK.map((k) => [k, ""])), ...env },
  });
  let output = "";
  child.stdout.on("data", (b) => (output += b));
  child.stderr.on("data", (b) => (output += b));
  const stop = async () => {
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
      if (child.exitCode !== null) throw new Error(`The isolated server exited: ${output.slice(-400)}`);
      if (i > 120) throw new Error(`The isolated server did not start within 60s: ${output.slice(-400)}`);
      health = await fetch(`${url}/api/health`).then((r) => (r.ok ? r.json() : null), () => null);
      if (health) break;
      await sleep(500);
    }
    if (health.storage !== (database === "postgres" ? "postgres" : "embedded")) throw new Error(`The isolated server is not using the expected ${database} database (storage: ${health.storage}). Something configured a different database; refusing to continue.`);
    const mine = new Set(processTree(child.pid));
    const others = listeners(port).filter((p) => !mine.has(p));
    if (others.length) throw new Error(`Port ${port} is held by another process (pid ${others.join(", ")}), not this server. Refusing to continue: it could be a stale server with a different database.`);
    return { url, port, dir, health, stop, output: () => output, pids: () => processTree(child.pid) };
  } catch (e) {
    await stop();
    throw e;
  }
}
