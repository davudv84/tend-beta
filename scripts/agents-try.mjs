#!/usr/bin/env node
// Try the real example agents WITHOUT any API key. Starts an isolated TEND (temp database, temp sandbox with fake files, a throwaway
// admin token) and runs the real CLI agent (examples/real-agents/<provider>-agent.mjs, official SDK) against a scripted local server
// that plays the model: read hello.txt, write agent-note.txt, try to delete hello.txt. TEND, the gateway, the policy, the approval and the
// file operations are all real. Only the model is a script, so this proves the plumbing, not a live model's behaviour.
//
//   npm run build                                   (once; this uses the production build)
//   npm run agents:try                              you approve the write in the dashboard (it prints the address and a throwaway token)
//   npm run agents:try -- --auto                    no clicking: this script plays the operator and checks the outcome (exit 1 if wrong)
//   npm run agents:try -- --auto --reject           the operator rejects the write; nothing is created
//   npm run agents:try -- --provider anthropic      openai | anthropic | both (default both)
//   npm run agents:try -- --confined                run the agent under OS confinement (macOS), see docs/manual-testing.md
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fakeAnthropic, fakeOpenAI } from "./fake-models.mjs";
import { canConfine, confinedSpawn } from "./confine.mjs";
import { listeners, startIsolatedServer } from "./isolated-server.mjs";
import { SUGGESTED_POLICY } from "./suggested-policy.mjs";

const root = path.resolve(import.meta.dirname, "..");
const flag = (n) => process.argv.includes(`--${n}`);
const pi = process.argv.indexOf("--provider");
const providers = pi > 0 ? [process.argv[pi + 1]] : ["openai", "anthropic"];
const auto = flag("auto"), reject = flag("reject"), confined = flag("confined");
const stop = (msg) => {
  console.error(msg);
  process.exit(2);
};
if (providers.some((p) => !["openai", "anthropic", "both"].includes(p))) stop("--provider must be openai, anthropic or both");
if (providers[0] === "both") providers.splice(0, 1, "openai", "anthropic");
if (confined && !canConfine()) stop("--confined needs macOS with /usr/bin/sandbox-exec. Not running unconfined.");

const ADMIN = `fake_admin_${randomBytes(18).toString("hex")}`;
const dataDir = mkdtempSync(path.join(tmpdir(), "tend-try-db-"));
const sandbox = mkdtempSync(path.join(tmpdir(), "tend-try-sandbox-"));
const HELLO = "FICTIONAL hello file: the quarterly picnic is on Friday.\n";
const files = () => Object.fromEntries(readdirSync(sandbox).sort().map((f) => [f, readFileSync(path.join(sandbox, f), "utf8")]));
const reset = () => {
  for (const f of readdirSync(sandbox)) rmSync(path.join(sandbox, f), { force: true });
  writeFileSync(path.join(sandbox, "hello.txt"), HELLO);
};
reset();

let server; // the isolated server, started in main()
let URL_ = "";
const cleanup = async () => {
  await server?.stop();
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(sandbox, { recursive: true, force: true });
};
process.on("SIGINT", async () => {
  await cleanup();
  process.exit(130);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = "";
async function call(method, p, { body, op } = {}) {
  const res = await fetch(URL_ + p, { method, headers: { ...(body !== undefined && { "content-type": "application/json" }), ...(op && { cookie }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

const SCRIPT = {
  turns: [
    [{ name: "read_test_file", input: { path: "hello.txt" } }],
    [{ name: "write_test_file", input: { path: "agent-note.txt", text: "hello.txt says the picnic is on Friday." } }],
    [{ name: "delete_test_file", input: { path: "hello.txt" } }],
  ],
  final: "Read hello.txt, asked to write agent-note.txt and tried to delete hello.txt. See the tool results for which of these happened.",
};
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); };

async function runProvider(name) {
  const label = name === "openai" ? "OpenAI" : "Anthropic";
  console.log(`\n=== ${label} agent (official SDK, scripted local model) ===`);
  reset();
  const reg = await call("POST", "/api/v1/agents", { op: true, body: { name: `${label} try-out agent`, model: "scripted", provider: label } });
  if (reg.status !== 201) throw new Error(`register failed: ${reg.status}`);
  const { id } = reg.body.agent;
  const key = reg.body.apiKey;
  if ((await call("POST", `/api/v1/agents/${id}/policy`, { op: true, body: { rules: SUGGESTED_POLICY, enforcement: "enforce" } })).status !== 200) throw new Error("policy failed");

  // Before any agent starts, authenticate with the new key the way an agent will. If THIS server rejects the key it just issued, nothing an agent
  // does can work, and the cause is the server (a different database, another process on the port), not the agent. Say so here.
  const probe = await fetch(`${URL_}/api/v1/agent/inbox`, { headers: { authorization: `Bearer ${key}` } }).then((r) => r.status, () => 0);
  if (probe !== 200) throw new Error(`The isolated server at ${URL_} rejected the key it had just issued (HTTP ${probe}). Database: ${server.health.storage}; processes on its port: ${listeners(server.port).join(", ") || "none"}; its own: ${server.pids().join(", ")}. This is a server problem, not an agent problem.`);
  console.log(`Registered ${label} agent on ${URL_}; key ${key.slice(0, 14)}… accepted by this server (embedded temp database).`);

  const fake = await (name === "openai" ? fakeOpenAI : fakeAnthropic)(SCRIPT);
  // The agent process gets exactly this: TEND's address, its own key, a placeholder provider key, and the scripted server as the provider's address.
  // TEND_AGENT_ENV_FILE= (empty): this throwaway agent must never read .env.agent, which holds the keys `agents:setup` saved for your REAL
  // TEND server (the agent prefers a provider-specific saved key over TEND_AGENT_KEY, so reading it here sends the wrong key to this server: 401).
  const env = { PATH: process.env.PATH ?? "", TMPDIR: tmpdir(), LC_ALL: "C", TEND_URL: URL_, TEND_AGENT_KEY: key, [name === "openai" ? "TEND_OPENAI_AGENT_KEY" : "TEND_ANTHROPIC_AGENT_KEY"]: key, TEND_AGENT_ENV_FILE: "",
    ...(name === "openai" ? { OPENAI_API_KEY: "offline-placeholder-key", OPENAI_BASE_URL: `${fake.url}/v1` } : { ANTHROPIC_API_KEY: "offline-placeholder-key", ANTHROPIC_BASE_URL: fake.url }) };
  const argv = [process.execPath, path.join(root, "examples/real-agents", `${name}-agent.mjs`)];
  const child = confined
    ? confinedSpawn(argv, { root, hidden: [sandbox, dataDir], env, stdio: ["ignore", "pipe", "pipe"] })
    : spawn(argv[0], argv.slice(1), { env, cwd: tmpdir(), stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  const echo = (d) => { out += d; process.stdout.write(d); };
  child.stdout.on("data", echo);
  child.stderr.on("data", echo);
  const exited = new Promise((r) => child.on("close", r));

  const decided = [];
  let running = true;
  const operator = (async () => {
    while (running) {
      const s = (await call("GET", "/api/v1/state", { op: true })).body.projection;
      for (const a of s.authorizations.filter((x) => x.agentId === id && x.status === "pending" && !decided.includes(x.id))) {
        if (!auto) {
          console.log(`\n>>> Waiting for YOU: open ${URL_}/oversight (sign in at ${URL_}/operator with the token printed above) and ${reject ? "reject" : "approve"} "${a.tool} ${a.resource}".`);
          decided.push(a.id);
          continue;
        }
        decided.push(a.id);
        await call("POST", `/api/v1/reviews/${a.id}`, { op: true, body: { status: reject ? "rejected" : "approved" } });
        console.log(`\n>>> (--auto) operator ${reject ? "rejected" : "approved"}: ${a.tool} ${a.resource} "${a.detail}"`);
      }
      await sleep(300);
    }
  })();
  const code = await exited;
  running = false;
  await operator;
  await fake.close();

  if (code !== 0 && /401|invalid_key/.test(out)) {
    const again = await fetch(`${URL_}/api/v1/agent/inbox`, { headers: { authorization: `Bearer ${key}` } }).then((r) => r.status, () => 0);
    const used = (out.match(/Using TEND at (\S+) with key (tend_sk_\S+?)… \(from ([^)]+)\)/) ?? []);
    console.log(`\nDiagnosis: the agent got a 401. This server accepts the key it issued (HTTP ${again}); the agent ${used[2] ? `used TEND ${used[1]} with key ${used[2]}… from ${used[3]}, registered key is ${key.slice(0, 14)}…` : "did not say which key it used"}.`);
  }

  console.log("\nChecks:");
  const f = files();
  check(code === 0, `the agent process finished (exit ${code})`);
  check(f["hello.txt"] === HELLO, "hello.txt is intact: the delete never happened");
  if (reject) check(!("agent-note.txt" in f), "the rejected write created no file");
  else check(f["agent-note.txt"] === "hello.txt says the picnic is on Friday.\n", "agent-note.txt holds exactly the approved text");
  check(fake.told.some((t) => t.includes("picnic")), "the file text reached the model only through TEND's read result");
  check(fake.told.some((t) => /denied: policy_denied/.test(t)), "the model was told the delete was denied by policy");
  check(!out.includes(key) && !out.includes(ADMIN), "no agent key or admin token in the agent's output");
  if (confined) check(!/EPERM/.test(out) || code === 0, "the confined agent ran normally");
}

try {
  server = await startIsolatedServer({ root, env: { TEND_ADMIN_TOKEN: ADMIN, TEND_GATEWAY_SANDBOX_DIR: sandbox, TEND_DATA_DIR: dataDir } });
  URL_ = server.url;
  const login = await call("POST", "/api/operator/session", { body: { token: ADMIN } });
  if (login.status !== 200) throw new Error("operator sign-in failed");
  cookie = login.headers.get("set-cookie").split(";")[0];
  console.log(`Isolated TEND on ${URL_} (temp database, temp sandbox of fictional files)${confined ? ", agent confined by the OS" : ""}.`);
  if (!auto) console.log(`Dashboard sign-in token for THIS throwaway instance: ${ADMIN}\n`);
  for (const p of providers) await runProvider(p);
} catch (e) {
  failures.push(String(e.message));
  console.error(`\nERROR: ${e.message}`);
}
await cleanup();
console.log(failures.length ? `\n${failures.length} problem(s):\n- ${failures.join("\n- ")}` : "\nAll checks passed. (No live model was involved: see docs/manual-testing.md for the real-key steps.)");
process.exit(failures.length ? 1 : 0);
