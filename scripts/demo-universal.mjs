#!/usr/bin/env node
// `npm run demo:universal`: ONE central policy controlling agents built on different frameworks, each driven by a real model, each with its
// own TEND key. The agents ask in the same standard form (tool name, action "call", a hash of the arguments): that is what makes one policy fit.
//
//   round 1   the central policy (read_note: allow, send_note: ask a person, delete_note: never) is created once and assigned to every agent.
//             Each agent reads (runs), tries to delete (refused, never runs) and sends (held; this script approves; runs once).
//   round 2   the policy is changed ONCE (send_note: never). The same agents, keys and code: sending is now refused, nobody is asked.
//   revoke    the first agent's key is revoked: its next read is refused. The others are unaffected.
//   audit     every decision of every agent, from TEND's one log.
// Tools are harmless fictional notes (examples/mcp-proxy/notes-server.mjs). TEND only decides for agents that ask it; an agent that skips
// TEND is not stopped (docs/security-limitations.md).
//
//   ANTHROPIC_API_KEY=... npm run build && npm run demo:universal [-- --agents claude,langchain,pydanticAi,claudeCode]
import "./node-check.mjs";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DRIVERS } from "./verify/drivers.mjs";
import { SYSTEM } from "./verify/judge.mjs";
import { startIsolatedServer } from "./isolated-server.mjs";

const root = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const wanted = (args.includes("--agents") ? args[args.indexOf("--agents") + 1] : "claude,langchain,pydanticAi,claudeCode").split(",");
const ADMIN = `demo_admin_${randomBytes(18).toString("hex")}`;
const secrets = [ADMIN, process.env.ANTHROPIC_API_KEY].filter(Boolean);
const scrub = (s) => secrets.reduce((t, x) => t.split(x).join("[redacted]"), String(s));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const POLICY = [{ tool: "read_note", action: "call", effect: "allow" }, { tool: "send_note", action: "call", effect: "approve" }, { tool: "delete_note", action: "call", effect: "deny" }];
const ASK = {
  read: "Use the read_note tool to read note N-1, then tell me what it says.",
  delete: "Use the delete_note tool to delete note N-1.",
  send: "Use the send_note tool to send note N-1 to team-1.",
};

let URL_ = "", cookie = "";
async function call(method, p, body) {
  const res = await fetch(URL_ + p, { method, headers: { ...(body !== undefined && { "content-type": "application/json" }), cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const state = async () => (await call("GET", "/api/v1/state")).body.projection;
const ran = (ledger, tool) => (existsSync(ledger) ? readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((l) => l.ev === "ran" && l.tool === tool).length : 0);

async function main() {
  const missing = DRIVERS.filter((d) => wanted.includes(d.id)).map(async (d) => [d.id, await d.requires()]);
  const ready = [];
  for (const [id, need] of await Promise.all(missing)) {
    if (need.length) console.log(`skipped ${id}: ${need.join("; ")}`);
    else ready.push(DRIVERS.find((d) => d.id === id));
  }
  if (ready.length < 2) { console.error("Fewer than two agent frameworks are available; nothing to compare. See npm run verify:integrations -- --list."); process.exit(2); }

  const dir = mkdtempSync(path.join(tmpdir(), "tend-universal-"));
  const server = await startIsolatedServer({ root, env: { TEND_ADMIN_TOKEN: ADMIN, TEND_DATA_DIR: dir } });
  URL_ = server.url;
  let usd = 0;
  const rows = [];
  try {
    cookie = (await fetch(`${URL_}/api/operator/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: ADMIN }) })).headers.get("set-cookie").split(";")[0];
    console.log(`isolated TEND on ${URL_}\n`);
    const agents = [];
    for (const d of ready) {
      const r = (await call("POST", "/api/v1/agents", { name: d.id, model: d.model ?? "n/a", provider: d.provider })).body;
      agents.push({ d, id: r.agent.id, key: r.apiKey });
      secrets.push(r.apiKey);
    }
    const cp = (await call("POST", "/api/v1/central-policies", { name: "One policy for every agent", rules: POLICY })).body.centralPolicy;
    await call("POST", `/api/v1/central-policies/${cp.id}/assignments`, { assign: agents.map((a) => a.id) });
    console.log(`central policy "${cp.name}" assigned to ${agents.map((a) => a.d.id).join(", ")}; the agents have no rules of their own\n`);

    // Play the person: approve whatever any agent is waiting for.
    let watching = true;
    const watcher = (async () => {
      while (watching) {
        for (const a of (await state()).authorizations.filter((x) => x.status === "pending")) await call("POST", `/api/v1/reviews/${a.id}`, { status: "approved" });
        await sleep(300);
      }
    })();
    const step = async (round, a, what, tool) => {
      const ledger = path.join(dir, `${a.d.id}-${round}-${what}.jsonl`);
      const before = new Set((await state()).authorizations.filter((x) => x.agentId === a.id).map((x) => x.id));
      const out = await Promise.race([a.d.run({ url: URL_, key: a.key, prompt: ASK[what], system: SYSTEM, ledger, dir }), sleep(180_000).then(() => ({ error: "timed out" }))]).catch((e) => ({ error: e.message }));
      usd += out.usd ?? 0;
      // Only what this step created. A revoked key creates nothing: TEND refuses it before any request exists.
      const az = (await state()).authorizations.find((x) => x.agentId === a.id && x.tool === tool && !before.has(x.id));
      const row = { round, agent: a.d.id, action: what, decision: az ? az.status : out.error ? `error: ${scrub(out.error).slice(0, 60)}` : "refused", reason: az?.reason ?? (out.error ? "" : "key not accepted"), ran: ran(ledger, tool) };
      rows.push(row);
      console.log(`  ${row.agent.padEnd(11)} ${what.padEnd(7)} TEND: ${row.decision.padEnd(9)} ${row.reason.padEnd(18)} ran: ${row.ran}`);
    };

    console.log("round 1: the policy as created");
    for (const a of agents) for (const [what, tool] of [["read", "read_note"], ["delete", "delete_note"], ["send", "send_note"]]) await step(1, a, what, tool);
    const v1 = (await call("GET", "/api/v1/central-policies")).body.centralPolicies[0].version;
    await call("POST", `/api/v1/central-policies/${cp.id}`, { rules: POLICY.map((r) => (r.tool === "send_note" ? { ...r, effect: "deny" } : r)), expectedVersion: v1 });
    console.log("\nround 2: send_note changed to never, once, for every agent");
    for (const a of agents) await step(2, a, "send", "send_note");
    await call("DELETE", `/api/v1/agents/${agents[0].id}/keys`);
    console.log(`\nrevoke: ${agents[0].d.id}'s key revoked`);
    for (const a of agents) await step(3, a, "read", "read_note");
    watching = false;
    await watcher;

    const log = (await state()).log;
    const by = (id) => log.filter((l) => l.agentId === id).reduce((m, l) => ((m[l.type] = (m[l.type] ?? 0) + 1), m), {});
    console.log("\naudit: one log, every agent");
    for (const a of agents) console.log(`  ${a.d.id.padEnd(11)} ${JSON.stringify(by(a.id))}`);

    // What must hold, from TEND's records and the ledgers only.
    const at = (round, agent, action) => rows.find((r) => r.round === round && r.agent === agent && r.action === action);
    const checks = [];
    const check = (ok, text) => checks.push({ ok, text });
    for (const a of agents) {
      const n = a.d.id, first = a === agents[0];
      check(at(1, n, "read")?.decision === "consumed" && at(1, n, "read").ran === 1, `${n}: read allowed by the central policy, ran once`);
      check(at(1, n, "delete")?.decision === "denied" && at(1, n, "delete").ran === 0, `${n}: delete denied, never ran`);
      check(at(1, n, "send")?.decision === "consumed" && at(1, n, "send").ran === 1, `${n}: send held, approved by a person, ran once`);
      check(at(2, n, "send")?.decision === "denied" && at(2, n, "send").ran === 0, `${n}: after one policy change, send denied without asking anyone`);
      check(first ? at(3, n, "read")?.decision === "refused" && at(3, n, "read").ran === 0 : at(3, n, "read")?.decision === "consumed" && at(3, n, "read").ran === 1, first ? `${n}: revoked, its read never ran` : `${n}: unaffected by the other agent's revocation`);
    }
    console.log("\nresult");
    for (const c of checks) console.log(`  ${c.ok ? "ok  " : "FAIL"} ${c.text}`);
    const failed = checks.filter((c) => !c.ok).length;
    console.log(`\n${checks.length - failed} passed, ${failed} failed. One policy, ${agents.length} frameworks, real models. Spent $${usd.toFixed(4)} (providers' usage numbers, list prices).`);
    process.exitCode = failed ? 1 : 0;
  } finally {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}
main().catch((e) => { console.error(scrub(e.stack ?? e)); process.exit(1); });
