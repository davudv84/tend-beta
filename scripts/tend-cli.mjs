#!/usr/bin/env node
// The operator's command line for a running TEND (the same API the dashboard uses). Signs in with TEND_ADMIN_TOKEN from .env.local, never prints it.
//
//   npm run tend -- status                                        address, agents, central policies, what waits for you
//   npm run tend -- pending                                       requests waiting for a decision, with the exact text
//   npm run tend -- approve <request id>  |  reject <request id>  decide one (exactly what `pending` showed)
//   npm run tend -- policy list
//   npm run tend -- policy create "<name>" --rule tool:action:effect [--rule ...] [--assign "<agent name>" ...]
//   npm run tend -- policy update "<name>" --rule tool:action:effect [--rule ...]
//   npm run tend -- policy assign "<name>" "<agent name>" [...]     |  policy unassign "<name>" "<agent name>" [...]
//   npm run tend -- simulate "<central policy>" --rule tool:action:effect [...]   what the change would have decided (read-only)
//   npm run tend -- simulate --agent "<agent name>" --rule ... [--days 30]         an agent's own rules; --assign "<agent>" for a new central policy
//   npm run tend -- audit [--agent "<agent name>"] [--last 30]     what TEND recorded, oldest first
//   npm run tend -- audit-verify                                  checks the log's hash chain; keep the printed head hash somewhere else
//
// Another address: TEND_URL=http://localhost:3100 npm run tend -- status
import "./node-check.mjs";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as nodeUtil from "node:util";
import { describeEvent, parseRule } from "./cli-lib.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (f) => {
  try {
    return nodeUtil.parseEnv(readFileSync(path.join(root, f), "utf8"));
  } catch {
    return {};
  }
};
const die = (m) => {
  console.error(m);
  process.exit(1);
};
const URL_ = process.env.TEND_URL ?? read(".env.agent").TEND_URL ?? "http://localhost:3000";
const ADMIN = process.env.TEND_ADMIN_TOKEN ?? read(".env.local").TEND_ADMIN_TOKEN ?? "";

const args = process.argv.slice(2);
const flags = (name) => args.flatMap((a, i) => (args[i - 1] === `--${name}` ? [a] : []));
const words = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));

let cookie = "";
async function call(method, p, body) {
  let res;
  try {
    res = await fetch(URL_ + p, { method, headers: { ...(body !== undefined && { "content-type": "application/json" }), ...(cookie && { cookie }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  } catch {
    die(`TEND is not reachable at ${URL_}. Start it with "npm run dev" (or set TEND_URL to the right address).`);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) die(`TEND refused: ${res.status} ${data?.error ?? ""}. ${data?.message ?? ""}${data?.errors ? ` ${data.errors.join("; ")}` : ""}`.trim());
  return { data, headers: res.headers };
}
async function signIn() {
  if (ADMIN.length < 24) die('TEND_ADMIN_TOKEN is not set. Run "npm run tester:init -- yourname" first (it writes .env.local), then start TEND with "npm run dev".');
  let res;
  try {
    res = await fetch(`${URL_}/api/operator/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: ADMIN }), signal: AbortSignal.timeout(15_000) });
  } catch {
    die(`TEND is not reachable at ${URL_}. Start it with "npm run dev" (or set TEND_URL to the right address).`);
  }
  if (res.status !== 200) die(`Sign-in was refused (${res.status}). Is the running TEND using the TEND_ADMIN_TOKEN in .env.local? Restart "npm run dev" after changing it.`);
  cookie = res.headers.get("set-cookie").split(";")[0];
}
const state = async () => (await call("GET", "/api/v1/state")).data.projection;
const agentsByName = async () => Object.fromEntries((await state()).agents.filter((a) => a.origin === "connected").map((a) => [a.name, a.id]));
async function agentIds(names) {
  const known = await agentsByName();
  return names.map((n) => known[n] ?? die(`No agent named "${n}". Known: ${Object.keys(known).map((k) => `"${k}"`).join(", ") || "none (register one with npm run tester:agent)"}.`));
}
async function centralByName(name) {
  const all = (await call("GET", "/api/v1/central-policies")).data.centralPolicies;
  return all.find((c) => c.name === name) ?? die(`No central policy named "${name}". Known: ${all.map((c) => `"${c.name}"`).join(", ") || "none"}.`);
}
const show = (c, names) => `"${c.name}" v${c.version}: ${c.rules.map((r) => `${r.tool}.${r.action}${r.resourcePrefix ? ` ${r.resourcePrefix}*` : ""}=${r.effect}`).join(", ") || "no rules"}; agents: ${c.agents.map((id) => names[id] ?? id).join(", ") || "none"}`;
const rulesFromFlags = () => {
  const r = flags("rule");
  if (!r.length) die("Give at least one --rule tool:action:effect (effect: allow, approve or deny).");
  try {
    return r.map(parseRule);
  } catch (e) {
    return die(e.message);
  }
};

const [cmd, sub, ...rest] = words;
if (!cmd || cmd === "help") {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//   ")).map((l) => l.slice(5)).join("\n"));
  process.exit(cmd ? 0 : 1);
}
await signIn();
const names = Object.fromEntries((await state()).agents.map((a) => [a.id, a.name]));

if (cmd === "status") {
  const st = await state();
  const centrals = (await call("GET", "/api/v1/central-policies")).data.centralPolicies;
  console.log(`TEND at ${URL_}`);
  console.log(`Agents: ${st.agents.filter((a) => a.origin === "connected").map((a) => a.name).join(", ") || "none yet (npm run tester:agent)"}`);
  console.log(`Central policies: ${centrals.length ? "" : "none"}`);
  for (const c of centrals) console.log(`  ${show(c, names)}`);
  console.log(`Waiting for you: ${st.authorizations.filter((a) => a.status === "pending").length} (npm run tend -- pending)`);
} else if (cmd === "pending") {
  const waiting = (await state()).authorizations.filter((a) => a.status === "pending");
  if (!waiting.length) console.log("Nothing is waiting for a decision.");
  for (const a of waiting) console.log(`${a.id}  ${names[a.agentId] ?? a.agentId} wants ${a.tool}.${a.action}${a.resource ? ` ${a.resource}` : ""}\n    exactly: ${a.detail ?? "(no detail)"}\n    decide:  npm run tend -- approve ${a.id}   |   npm run tend -- reject ${a.id}`);
} else if (cmd === "approve" || cmd === "reject") {
  if (!sub) die(`Which request? npm run tend -- ${cmd} <request id> (see npm run tend -- pending)`);
  await call("POST", `/api/v1/reviews/${encodeURIComponent(sub)}`, { status: cmd === "approve" ? "approved" : "rejected" });
  console.log(`${cmd === "approve" ? "Allowed once" : "Rejected"}: ${sub}`);
} else if (cmd === "policy") {
  if (sub === "list") {
    const centrals = (await call("GET", "/api/v1/central-policies")).data.centralPolicies;
    if (!centrals.length) console.log('No central policies yet. Create one: npm run tend -- policy create "Baseline" --rule send_email:send:approve --assign "My agent"');
    for (const c of centrals) console.log(show(c, names));
  } else if (sub === "create") {
    const [name] = rest;
    if (!name) die('Give it a name: npm run tend -- policy create "Baseline" --rule tool:action:effect');
    const rules = rulesFromFlags();
    const assign = flags("assign").length ? await agentIds(flags("assign")) : [];
    let c = (await call("POST", "/api/v1/central-policies", { name, rules })).data.centralPolicy;
    if (assign.length) c = (await call("POST", `/api/v1/central-policies/${c.id}/assignments`, { assign })).data.centralPolicy;
    console.log(`Created ${show(c, names)}`);
  } else if (sub === "update") {
    const c0 = await centralByName(rest[0] ?? die("Which central policy? npm run tend -- policy update \"<name>\" --rule ..."));
    const c = (await call("POST", `/api/v1/central-policies/${c0.id}`, { rules: rulesFromFlags(), expectedVersion: c0.version })).data.centralPolicy;
    console.log(`Updated ${show(c, names)} (in force for every assigned agent now)`);
  } else if (sub === "assign" || sub === "unassign") {
    const [name, ...agentNames] = rest;
    if (!name || !agentNames.length) die(`npm run tend -- policy ${sub} "<policy name>" "<agent name>" [...]`);
    const c0 = await centralByName(name);
    const c = (await call("POST", `/api/v1/central-policies/${c0.id}/assignments`, { [sub]: await agentIds(agentNames) })).data.centralPolicy;
    console.log(`${sub === "assign" ? "Assigned" : "Unassigned"}: ${show(c, names)}`);
  } else die("policy list | create | update | assign | unassign (npm run tend -- help)");
} else if (cmd === "simulate") {
  // Replays recorded requests through the proposed rules on the server. Nothing runs and nothing is saved.
  const rules = rulesFromFlags();
  const days = flags("days").length ? Number(flags("days")[0]) : undefined;
  const target = flags("agent").length ? { agentId: (await agentIds(flags("agent")))[0] }
    : flags("assign").length ? { agentIds: await agentIds(flags("assign")) }
    : sub ? { centralPolicyId: (await centralByName(sub)).id } : die('simulate "<central policy>" | --agent "<agent>" | --assign "<agent>" ..., with --rule tool:action:effect');
  const r = (await call("POST", "/api/v1/policy-simulations", { ...target, rules, ...(days && { days }) })).data;
  console.log(`Simulated against ${r.actions} recorded action(s) from the last ${r.days} day(s)${r.truncated ? " (the most recent 5000)" : ""}. Nothing was run or saved.`);
  console.log(`  would allow ${r.would.allow}, ask ${r.would.approve}, block ${r.would.deny}   (it was: allowed ${r.was.allow}, asked ${r.was.approve}, blocked ${r.was.deny})`);
  for (const [k, n] of Object.entries(r.changes)) console.log(`  ${n} ${k.replace("->", " -> ")}`);
  for (const a of r.agents) console.log(`  ${a.name}: ${a.actions} action(s), ${a.changed} decided differently`);
  for (const x of r.examples.slice(0, 10)) console.log(`    ${names[x.agentId] ?? x.agentId}  ${x.tool}.${x.action}${x.resource ? ` ${x.resource}` : ""}: ${x.was} -> ${x.would} (${x.reason})`);
} else if (cmd === "audit-verify") {
  const r = (await call("GET", "/api/admin/audit")).data;
  if (r.ok) console.log(`Audit chain intact: ${r.checked} event(s) checked${r.firstChained ? ` from #${r.firstChained}` : ""}. Head hash: ${r.head ?? "none yet"}\nKeep this hash outside TEND; a history rewritten later will not end in it.`);
  else { console.log(`AUDIT CHAIN BROKEN at event #${r.brokenAt}: ${r.reason} (${r.checked} checked before it).`); process.exitCode = 1; }
} else if (cmd === "audit") {
  const only = flags("agent").length ? new Set(await agentIds(flags("agent"))) : null;
  const last = Number(flags("last")[0] ?? 30);
  let seq = 0, events = [], more = true;
  while (more) {
    const page = (await call("GET", `/api/v1/events?since=${seq}`)).data;
    events = events.concat(page.events);
    more = page.more && page.seq > seq;
    seq = page.seq;
  }
  const lines = events.filter((e) => !only || only.has(e.agentId)).map((e) => [e, describeEvent(e, names)]).filter(([, l]) => l).slice(-last);
  if (!lines.length) console.log("Nothing recorded yet.");
  for (const [e, l] of lines) console.log(`${new Date(e.at).toISOString().replace("T", " ").slice(0, 19)}  ${l}`);
} else die(`Unknown command "${cmd}". npm run tend -- help`);
