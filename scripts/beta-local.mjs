#!/usr/bin/env node
// Three isolated TEND beta instances on YOUR machine, reachable by testers through a Cloudflare Tunnel (free). Nothing here talks to the internet:
// the runner only listens on 127.0.0.1; `cloudflared` (a separate program you run) is what makes them reachable, outbound-only, no open ports.
//
//   npm run beta:local -- provision alice bob carol     beta-envs/<name>/local.env (mode 600): own port, own strong admin token; data folders beta-data/<name>/
//   npm run beta:local -- check                         the isolation rules (distinct tokens, ports, folders; strong tokens; private files)
//   npm run beta:local -- start                         starts every instance (production build, confined on macOS), keeps them healthy, Ctrl-C stops all
//   npm run beta:local -- tunnel-config example.com     prints the cloudflared config for <name>.example.com -> each instance
//
// Each instance: its own process, port, embedded database folder and file-sandbox folder; private (TEND_PUBLIC=0), no demo (TEND_DEMO=0), and
// TEND_TRUSTED_PROXY=1 because exactly one proxy (the tunnel) is in front, so caller addresses and rate limits are right. Those three are fixed here, not in the files.
// It runs from a throwaway project folder, so your .env.local is never read (scripts/isolated-server.mjs). On macOS each server also runs confined:
// it can write only to its own folders and cannot read your credentials, other instances' folders or this repository's secrets.
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { adminTokenProblem } from "../src/server/config.ts";
import { canConfine } from "./confine.mjs";
import { startIsolatedServer } from "./isolated-server.mjs";

const NAME = /^[a-z0-9][a-z0-9-]{0,30}$/;
const FIRST_PORT = 4501;

const instanceDirs = (work, name) => ({ env: path.join(work, "beta-envs", name, "local.env"), db: path.join(work, "beta-data", name, "db"), sandbox: path.join(work, "beta-data", name, "sandbox") });

export function provision(work, names) {
  mkdirSync(path.join(work, "beta-envs"), { recursive: true, mode: 0o700 });
  mkdirSync(path.join(work, "beta-data"), { recursive: true, mode: 0o700 });
  const used = new Set(Object.values(loadAll(work).instances).map((i) => Number(i.PORT)));
  let port = FIRST_PORT;
  const made = [];
  for (const name of names) {
    if (!NAME.test(name)) throw new Error(`"${name}" is not a usable instance name (lowercase letters, digits and hyphens).`);
    const d = instanceDirs(work, name);
    if (existsSync(d.env)) throw new Error(`${name} already has a local.env; refusing to overwrite its secrets.`);
    while (used.has(port)) port++;
    used.add(port);
    mkdirSync(path.dirname(d.env), { recursive: true, mode: 0o700 });
    for (const dir of [d.db, d.sandbox]) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      chmodSync(dir, 0o700);
    }
    writeFileSync(d.env, `# Beta instance "${name}" (local hosting). Secrets: keep private; git-ignored.\nPORT=${port}\nTEND_ADMIN_TOKEN=${randomBytes(32).toString("base64url")}\nTEND_GATEWAY_PAYMENTS_KEY=${randomBytes(24).toString("base64url")}\n`, { mode: 0o600 });
    chmodSync(d.env, 0o600);
    writeFileSync(path.join(d.sandbox, "hello.txt"), "Hello from your TEND test sandbox. This file is disposable.\n", { flag: "wx" });
    made.push({ name, port });
    port++;
  }
  return made;
}

export function loadAll(work) {
  const dir = path.join(work, "beta-envs");
  const instances = {}, modes = {};
  if (!existsSync(dir)) return { instances, modes };
  for (const name of readdirSync(dir).sort()) {
    const f = path.join(dir, name, "local.env");
    if (!existsSync(f)) continue;
    instances[name] = parseEnv(readFileSync(f, "utf8"));
    modes[name] = statSync(f).mode & 0o777;
  }
  return { instances, modes };
}

/** @returns {{ instance: string, level: "fail" | "warn" | "ok", text: string }[]} */
export function check(instances, modes = {}) {
  const out = [], seen = { token: new Map(), port: new Map(), payments: new Map() };
  const add = (instance, level, text) => out.push({ instance, level, text });
  const dup = (kind, instance, value, label) => {
    const other = seen[kind].get(value);
    if (other) add(instance, "fail", `${label} is the same as ${other}'s: instances must share nothing.`);
    else seen[kind].set(value, instance);
  };
  for (const [name, env] of Object.entries(instances)) {
    const problem = adminTokenProblem(env.TEND_ADMIN_TOKEN ?? "", true) ?? (env.TEND_ADMIN_TOKEN ? undefined : "missing");
    add(name, problem ? "fail" : "ok", problem ? `TEND_ADMIN_TOKEN is ${problem}.` : "admin token is strong.");
    if (env.TEND_ADMIN_TOKEN) dup("token", name, env.TEND_ADMIN_TOKEN, "TEND_ADMIN_TOKEN");
    if (env.TEND_GATEWAY_PAYMENTS_KEY) dup("payments", name, env.TEND_GATEWAY_PAYMENTS_KEY, "TEND_GATEWAY_PAYMENTS_KEY");
    const port = Number(env.PORT);
    if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 3000) add(name, "fail", `PORT must be a number from 1024 to 65535 and not 3000 (your development server), got "${env.PORT}".`);
    else dup("port", name, port, `PORT ${port}`);
    for (const forbidden of ["TEND_PUBLIC", "TEND_DEMO", "TEND_TRUSTED_PROXY", "TEND_LOCAL_HTTP", "DATABASE_URL", "TEND_DATA_DIR", "NODE_ENV"]) if (env[forbidden] !== undefined) add(name, "fail", `${forbidden} must not be set here: the runner fixes it (private, no demo, one trusted proxy, its own folders).`);
    if (modes[name] !== undefined && modes[name] & 0o077) add(name, "fail", `local.env is readable by other accounts (mode ${modes[name].toString(8)}); chmod 600.`);
  }
  if (Object.keys(instances).length < 2) add("-", "warn", "only one instance found: nothing to compare for isolation.");
  return out;
}

export function tunnelConfig(instances, domain) {
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(domain)) throw new Error(`"${domain}" is not a domain name.`);
  return [
    "# ~/.cloudflared/config.yml (replace the two placeholders; `cloudflared tunnel create tend-beta` prints the id)",
    "tunnel: <TUNNEL-ID>",
    "credentials-file: /Users/<you>/.cloudflared/<TUNNEL-ID>.json",
    "ingress:",
    // httpHostHeader pins the Host the app sees to the public name, which TEND's same-site check compares with the browser's Origin
    ...Object.entries(instances).flatMap(([name, env]) => [`  - hostname: ${name}.${domain}`, `    service: http://127.0.0.1:${env.PORT}`, "    originRequest:", `      httpHostHeader: ${name}.${domain}`]),
    "  - service: http_status:404",
    "",
  ].join("\n");
}

/** Starts every instance and keeps it healthy. Returns { servers, stop }. */
export async function startAll({ root, work = root, confined = true, log = console.log }) {
  const { instances } = loadAll(work);
  const failing = check(instances).filter((r) => r.level === "fail");
  if (failing.length) throw new Error(`Configuration problems (run "check"): ${failing.map((f) => `[${f.instance}] ${f.text}`).join(" ")}`);
  if (!Object.keys(instances).length) throw new Error('No instances. Run: npm run beta:local -- provision <names>');
  if (confined && !canConfine()) throw new Error("Confinement needs macOS with /usr/bin/sandbox-exec. Not starting unconfined; pass --unconfined only if you accept that.");
  const servers = {};
  const launch = async (name) => {
    const env = instances[name], d = instanceDirs(work, name);
    for (const dir of [d.db, d.sandbox]) mkdirSync(dir, { recursive: true, mode: 0o700 });
    servers[name] = await startIsolatedServer({
      root, port: Number(env.PORT), confine: confined ? { allowWrite: [d.db, d.sandbox], hidden: [path.join(work, "beta-data"), path.join(work, "beta-envs")] } : undefined, // every instance's folders are hidden, then this one's own are re-allowed
      env: { TEND_ADMIN_TOKEN: env.TEND_ADMIN_TOKEN, TEND_GATEWAY_PAYMENTS_KEY: env.TEND_GATEWAY_PAYMENTS_KEY, TEND_DATA_DIR: d.db, TEND_GATEWAY_SANDBOX_DIR: d.sandbox, TEND_TRUSTED_PROXY: "1", TEND_LOCAL_HTTP: "", TEND_PUBLIC: "0", TEND_DEMO: "0" },
    });
    log(`${name}: http://127.0.0.1:${env.PORT}  ${confined ? "(confined)" : "(NOT confined)"}`);
  };
  for (const name of Object.keys(instances)) await launch(name);
  let stopping = false;
  const failures = Object.fromEntries(Object.keys(instances).map((n) => [n, 0]));
  const timer = setInterval(async () => {
    for (const name of Object.keys(instances)) {
      if (stopping) return;
      const ok = await fetch(`http://127.0.0.1:${instances[name].PORT}/api/health`, { signal: AbortSignal.timeout(5000) }).then((r) => r.ok, () => false);
      failures[name] = ok ? 0 : failures[name] + 1;
      if (failures[name] >= 3) {
        log(`${name}: not answering, restarting`);
        failures[name] = 0;
        await servers[name].stop().catch(() => {});
        await launch(name).catch((e) => log(`${name}: restart failed: ${e.message}`));
      }
    }
  }, 10_000);
  timer.unref();
  return { servers, instances, stop: async () => { stopping = true; clearInterval(timer); for (const s of Object.values(servers)) await s.stop().catch(() => {}); } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(import.meta.dirname, "..");
  const [cmd, ...args] = process.argv.slice(2);
  const die = (m, code = 1) => {
    console.error(m);
    process.exit(code);
  };
  if (cmd === "provision") {
    if (!args.length) die("Usage: npm run beta:local -- provision <name> [<name> …]", 2);
    try {
      for (const m of provision(root, args)) console.log(`${m.name}: port ${m.port}, beta-envs/${m.name}/local.env (mode 600), data in beta-data/${m.name}/`);
    } catch (e) {
      die(e.message);
    }
  } else if (cmd === "check") {
    const { instances, modes } = loadAll(root);
    if (!Object.keys(instances).length) die("No beta-envs/*/local.env. Run: npm run beta:local -- provision <names>", 2);
    const r = check(instances, modes);
    for (const x of r) console.log(`${x.level === "ok" ? "ok  " : x.level === "warn" ? "WARN" : "FAIL"} [${x.instance}] ${x.text}`);
    process.exit(r.some((x) => x.level === "fail") ? 1 : 0);
  } else if (cmd === "tunnel-config") {
    const { instances } = loadAll(root);
    try {
      console.log(tunnelConfig(instances, args[0] ?? ""));
    } catch (e) {
      die(e.message, 2);
    }
  } else if (cmd === "start") {
    const confined = !args.includes("--unconfined");
    try {
      const run = await startAll({ root, confined });
      console.log(`\nRunning ${Object.keys(run.servers).length} instance(s). Keep this window open; Ctrl-C stops them. The machine must stay awake (keeping it awake while this runs).`);
      if (process.platform === "darwin") spawn("caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore" }).unref();
      const bye = async () => {
        await run.stop();
        process.exit(0);
      };
      process.on("SIGINT", bye);
      process.on("SIGTERM", bye);
      setInterval(() => {}, 1 << 30);
    } catch (e) {
      die(e.message);
    }
  } else {
    die("Usage: node scripts/beta-local.mjs provision <names…> | check | start [--unconfined] | tunnel-config <domain>", 2);
  }
}
