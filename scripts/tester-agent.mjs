#!/usr/bin/env node
// Registers YOUR agent with your local TEND and says which of its tools need a person.
//
//   npm run tester:agent -- "My support bot" --rule send_refund:execute:approve --rule read_ticket:read:allow
//
// A rule is tool:action:effect[:resourcePrefix]; effect is allow, approve (a person decides) or deny. Anything without a rule is denied.
// Saves the agent's key to .env.agent as TEND_AGENT_KEY (mode 600) the moment it exists, together with TEND_URL. Never prints a key or token.
// Run it again to change the rules: the working key is kept. Operator tool: it needs TEND_ADMIN_TOKEN from .env.local.
import { chmodSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

const root = path.resolve(import.meta.dirname, "..");
const read = (f) => {
  try {
    return parseEnv(readFileSync(path.join(root, f), "utf8"));
  } catch {
    return {};
  }
};
const die = (m) => {
  console.error(m);
  process.exit(1);
};

const args = process.argv.slice(2);
const name = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--rule");
const rules = args.flatMap((a, i) => (args[i - 1] === "--rule" ? [a] : [])).map((r) => {
  const [tool, action, effect, resourcePrefix] = r.split(":");
  if (!tool || !action || !["allow", "approve", "deny"].includes(effect)) die(`Bad rule "${r}". Use tool:action:effect, effect being allow, approve or deny.`);
  return { tool, action, effect, ...(resourcePrefix && { resourcePrefix }) };
});
if (!name || !rules.length) die('Usage: npm run tester:agent -- "Agent name" --rule tool:action:effect [--rule ...]');

const URL_ = process.env.TEND_URL ?? read(".env.agent").TEND_URL ?? "http://localhost:3000";
const ADMIN = process.env.TEND_ADMIN_TOKEN ?? read(".env.local").TEND_ADMIN_TOKEN ?? "";
if (ADMIN.length < 24) die("TEND_ADMIN_TOKEN is missing. Run `npm run tester:init` first.");

let cookie = "";
async function call(method, p, { body, key } = {}) {
  let res;
  try {
    res = await fetch(URL_ + p, {
      method,
      headers: { ...(body && { "content-type": "application/json" }), ...(key ? { authorization: `Bearer ${key}` } : cookie && { cookie }) },
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    die(`Could not reach TEND at ${URL_}. Start it first with:  npm run dev   (another port? set TEND_URL)`);
  }
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}
const must = (r, what, ok = (s) => s < 300) => {
  if (!ok(r.status)) die(`${what} failed (${r.status} ${r.body?.error ?? ""} ${r.body?.errors?.join?.("; ") ?? ""}).`);
  return r.body;
};

const login = await call("POST", "/api/operator/session", { body: { token: ADMIN } });
if (login.status !== 200) die(`Sign-in was refused (${login.status}). Is the running server using the TEND_ADMIN_TOKEN in .env.local? Restart \`npm run dev\` after changing it.`);
cookie = login.headers.get("set-cookie").split(";")[0];

const saved = read(".env.agent");
const known = (must(await call("GET", "/api/v1/state"), "Reading TEND's state").projection?.agents ?? []).find((a) => a.name === name && a.origin === "connected");
let id = known?.id, key = saved.TEND_AGENT_KEY, action = "kept";
const works = known && key && (await call("GET", "/api/v1/agent/inbox", { key })).status === 200;
if (!works) {
  if (known) {
    key = must(await call("POST", `/api/v1/agents/${known.id}/keys`, { body: {} }), "Rotating the key").apiKey;
    action = "issued a new key for";
  } else {
    const reg = must(await call("POST", "/api/v1/agents", { body: { name, model: "custom", provider: "Custom", role: "Tester's own agent" } }), `Registering ${name}`, (s) => s === 201);
    id = reg.agent.id;
    key = reg.apiKey;
    action = "registered";
  }
  const tmp = path.join(root, `.env.agent.${process.pid}.tmp`);
  const next = { ...saved, TEND_AGENT_KEY: key, TEND_URL: URL_ };
  writeFileSync(tmp, `# Agent keys and provider keys. Git-ignored; never commit.\n${Object.entries(next).map(([k, v]) => `${k}=${v}`).join("\n")}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path.join(root, ".env.agent")); // atomic: a crash never leaves half a file
}
must(await call("POST", `/api/v1/agents/${id}/policy`, { body: { rules, enforcement: "enforce" } }), "Saving the rules", (s) => s === 200);
const back = await call("GET", "/api/v1/agent/inbox", { key });
if (back.status !== 200) die(`TEND refuses the key it just saved (${back.status}). Run this command again.`);
console.log(`${action === "kept" ? "Kept the working key of" : `I ${action}`} "${name}" (${id}); key saved in .env.agent as TEND_AGENT_KEY.`);
for (const r of rules) console.log(`  ${r.tool}.${r.action}${r.resourcePrefix ? ` ${r.resourcePrefix}*` : ""}: ${{ allow: "allowed", approve: "asks you first", deny: "never" }[r.effect]}`);
