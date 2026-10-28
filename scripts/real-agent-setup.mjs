#!/usr/bin/env node
// One-time (and repeatable) local setup for the real-agent examples. Run it where the TEND server is running; it is an OPERATOR
// tool, so it needs the admin token, which the agent processes must never have (they refuse to start if they do).
//
//   npm run agents:setup                  registers "OpenAI test agent" and "Claude test agent" and sets their policy
//   npm run agents:setup -- openai        only one of them
//   npm run agents:setup -- --check       test the saved keys the way the agents use them; changes nothing
//   npm run agents:setup -- --rotate      issue new keys even if the saved ones still work (this ends the old ones)
//
// What it does, through the same operator API the dashboard uses (logic and its safety rules: real-agent-setup-lib.mjs):
//   1. signs in with TEND_ADMIN_TOKEN (from .env.local or the environment; never printed),
//   2. registers each agent, or keeps its key if the saved one still works, or issues a new one if it does not,
//   3. sets its policy: read_test_file ALLOW, write_test_file ASK ME FIRST, delete_test_file NEVER, in enforce mode,
//   4. saves each key to .env.agent (git-ignored, mode 600) the moment it exists, with the TEND address that issued it,
//   5. creates the sandbox folder with one disposable file, and tells you whether the server has the sandbox switched on,
//   6. authenticates with what it saved, read back from disk, and fails if TEND refuses it.
// It never prints a key or token.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { bypass } from "../examples/claude-agent/agent.mjs";
import { loadAgentEnvDetailed, resolveAgent } from "../examples/real-agents/env.mjs";
import { checkAgents, setupAgents } from "./real-agent-setup-lib.mjs";
import { SUGGESTED_POLICY as POLICY } from "./suggested-policy.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (f) => {
  try {
    return parseEnv(readFileSync(path.join(root, f), "utf8"));
  } catch {
    return {};
  }
};
const local = read(".env.local");
// The address defaults to the one the saved keys were issued by, so a re-run cannot quietly talk to a different TEND than the agents do.
const URL_ = process.env.TEND_URL ?? read(".env.agent").TEND_URL ?? "http://localhost:3000";
const ADMIN = process.env.TEND_ADMIN_TOKEN ?? local.TEND_ADMIN_TOKEN ?? "";
const SANDBOX = process.env.TEND_GATEWAY_SANDBOX_DIR ?? local.TEND_GATEWAY_SANDBOX_DIR ?? path.join(root, ".agent-sandbox");
const AGENTS = {
  openai: { name: "OpenAI test agent", model: "gpt-4.1-mini", provider: "OpenAI", envVar: "TEND_OPENAI_AGENT_KEY" },
  anthropic: { name: "Claude test agent", model: "claude-haiku-4-5", provider: "Anthropic", envVar: "TEND_ANTHROPIC_AGENT_KEY" },
};

const die = (msg) => {
  console.error(msg);
  process.exit(1);
};
const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));
const only = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (only && !AGENTS[only]) die(`Unknown agent "${only}". Use openai or anthropic.`);
const wanted = only ? [only] : Object.keys(AGENTS);
const check = flags.includes("--check"), rotate = flags.includes("--rotate");
console.log(`TEND server: ${URL_}`);

// ---- the disk: .env.agent, replaced atomically so a crash can never leave half a file ----------------------------
const envFile = path.join(root, ".env.agent");
const quote = (v) => (/[\s#"'`\\]/.test(v) ? JSON.stringify(v) : v);
const files = {
  writable() {
    try {
      this.write(this.read()); // the same write the real save does, so "can save" means "did save"
    } catch (e) {
      die(`Cannot write ${envFile} (${e.code ?? e.message}). Nothing was changed on the TEND server. Fix the file's permissions or owner (it should be yours, mode 600) and run this again.`);
    }
  },
  read: () => read(".env.agent"),
  write(obj) {
    const tmp = `${envFile}.${process.pid}.tmp`;
    writeFileSync(tmp, `# Written by npm run agents:setup. Agent keys (and the TEND address that issued them) plus your provider keys. Git-ignored; never commit.\n${Object.entries(obj).map(([k, v]) => `${k}=${quote(v)}`).join("\n")}\n`, { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, envFile);
  },
};
const resolve = (provider) => resolveAgent(loadAgentEnvDetailed(root), provider);

// ---- the server --------------------------------------------------------------------------------------------------
let cookie = "";
async function call(method, p, { body, key, base = URL_ } = {}) {
  let res;
  try {
    res = await fetch(base + p, {
      method,
      headers: { ...(body && { "content-type": "application/json" }), ...(cookie && !key && { cookie }), ...(key && { authorization: `Bearer ${key}` }), ...bypass() },
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    die(`Could not reach TEND at ${base}. Start it first with:  npm run dev   (if it runs on another port, set TEND_URL)`);
  }
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}
const must = (r, what, ok = (s) => s < 300) => {
  if (!ok(r.status)) die(`${what} failed (${r.status} ${r.body?.error ?? ""} ${r.body?.errors?.join?.("; ") ?? ""}).`);
  return r.body;
};
const api = {
  url: URL_,
  async signIn() {
    if (ADMIN.length < 24) die("TEND_ADMIN_TOKEN (at least 24 characters) is not set in .env.local or the environment. It is the token you sign in to the dashboard with.");
    const r = await call("POST", "/api/operator/session", { body: { token: ADMIN } });
    if (r.status !== 200) die(`Sign-in was refused (${r.status} ${r.body?.error ?? ""}). Is TEND_ADMIN_TOKEN in .env.local the one the running server loaded? Restart \`npm run dev\` after changing it. (Is ${URL_} the TEND you mean?)`);
    cookie = r.headers.get("set-cookie").split(";")[0];
  },
  state: async () => (await call("GET", "/api/v1/state")).body,
  register: async (body) => {
    const b = must(await call("POST", "/api/v1/agents", { body }), `Registering ${body.name}`, (s) => s === 201);
    return { id: b.agent.id, apiKey: b.apiKey };
  },
  rotate: async (id) => must(await call("POST", `/api/v1/agents/${id}/keys`, { body: {} }), "Rotating the key").apiKey,
  setPolicy: async (id, rules) => void must(await call("POST", `/api/v1/agents/${id}/policy`, { body: { rules, enforcement: "enforce" } }), "Setting the policy", (s) => s === 200),
  policyView: async (id) => must(await call("GET", `/api/v1/agents/${id}/policy`), "Reading the policy back"),
  keyStatus: async (key, base = URL_) => (await call("GET", "/api/v1/agent/inbox", { key, base })).status,
};

if (check) {
  const results = await checkAgents({ api, resolve, agents: AGENTS, wanted });
  for (const r of results) {
    console.log(`${r.ok ? "ok  " : "FAIL"} ${r.text}`);
    for (const w of r.warnings) console.log(`     Warning: ${w}`);
  }
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

// The sandbox folder, private to you (mode 700). Created after the key file is known to be writable, before anything is registered.
files.writable();
mkdirSync(SANDBOX, { recursive: true, mode: 0o700 });
chmodSync(SANDBOX, 0o700);
const hello = path.join(SANDBOX, "hello.txt");
if (!existsSync(hello)) writeFileSync(hello, "Hello from the TEND test sandbox. This file is disposable.\n");

try {
  await setupAgents({ api, files, resolve, agents: AGENTS, policy: POLICY, wanted, rotate, log: console.log });
} catch (e) {
  die(`\n${e.message}`);
}
console.log(`Agent keys are in .env.agent (mode 600) and were tested against ${URL_}.`);
const configured = (local.TEND_GATEWAY_SANDBOX_DIR ?? process.env.TEND_GATEWAY_SANDBOX_DIR) === SANDBOX;
console.log(`Sandbox folder: ${SANDBOX} (seeded with hello.txt)`);
if (!configured) console.log(`\nThe TEND server needs to know the sandbox folder. Add this line to .env.local and restart \`npm run dev\`:\n\n  TEND_GATEWAY_SANDBOX_DIR=${SANDBOX}\n`);
console.log("Next: add OPENAI_API_KEY and/or ANTHROPIC_API_KEY to .env.agent, then  npm run agents:openai  /  npm run agents:anthropic");
