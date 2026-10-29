// Policy simulation replays recorded requests through the enforcing decision function, read-only: nothing runs, nothing changes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { authAgent } from "./agent-auth.ts";
import { claimToken, consumeAuthorization, requestAuthorization } from "./authz.ts";
import { memoryDb, type DB } from "./db.ts";
import { assignCentralPolicy, createCentralPolicy, decide, registerAgent, setPolicy } from "./repo.ts";
import { simulatePolicy } from "./simulate.ts";

process.env.TEND_DEMO = "0";
const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
const RULES = [{ tool: "read_note", action: "call", effect: "allow" }, { tool: "send_note", action: "call", effect: "approve" }, { tool: "delete_note", action: "call", effect: "deny" }];

/** An agent with a history: two reads (allowed, one used), one send (approved and used), one delete (denied), one unknown tool (no rule). */
async function history(db: DB, name: string, workspace?: string) {
  const r = await registerAgent(db, { name, model: "m", provider: "Custom" }, "op", workspace);
  await setPolicy(db, r.agent.id, RULES, "enforce");
  const agent = (await authAgent(db, new Request("http://t/", { headers: { authorization: `Bearer ${r.apiKey}` } })))!;
  const ask = (tool: string, resource = "N-1") => requestAuthorization(db, agent, { tool, action: "call", resource }, null).then((x) => x.view);
  const read = await ask("read_note");
  const t = await claimToken(db, agent, read.id);
  await consumeAuthorization(db, agent, read.id, { token: (t.view as { token: string }).token, tool: "read_note", action: "call", resource: "N-1" });
  await ask("read_note", "N-2");
  const send = await ask("send_note");
  await decide(db, send.id, "approved");
  await ask("delete_note");
  await ask("format_disk");
  return { id: r.agent.id };
}
const snapshotOf = async (db: DB) => JSON.stringify(await Promise.all(["authorizations", "events", "agents", "central_policies", "reviews"].map((t) => db.all(`SELECT * FROM ${t} ORDER BY 1`))));

test("a stricter proposal: what would be allowed, held or blocked, compared with what happened, and nothing changes", async () => {
  const db = await memoryDb();
  const a = await history(db, "Mailer");
  const before = await snapshotOf(db);
  const s = await simulatePolicy(db, { agentId: a.id, rules: [{ tool: "read_note", action: "call", effect: "approve" }, { tool: "send_note", action: "call", effect: "deny" }] });
  assert.equal(s.executed, false);
  assert.equal(s.actions, 5);
  assert.deepEqual(s.was, { allow: 2, approve: 1, deny: 2 });
  assert.deepEqual(s.would, { allow: 0, approve: 2, deny: 3 });
  assert.deepEqual(s.changes, { "allow->approve": 2, "approve->deny": 1 });
  assert.deepEqual(s.affected, [a.id]);
  assert.equal(s.examples.length, 3);
  assert.equal(await snapshotOf(db), before, "no row anywhere changed: nothing ran, nothing was decided");
  await db.close();
});

test("a central proposal covers every assigned agent, and the agents' own stricter rules still win, as in enforcement", async () => {
  const db = await memoryDb();
  const a = await history(db, "A"), b = await history(db, "B"), c = await history(db, "C");
  const cp = await createCentralPolicy(db, { name: "Base", rules: RULES }, "op");
  await assignCentralPolicy(db, cp.id, { assign: [a.id, b.id] }, "op");
  const s = await simulatePolicy(db, { centralPolicyId: cp.id, rules: [{ tool: "read_note", action: "call", effect: "allow" }, { tool: "send_note", action: "call", effect: "allow" }, { tool: "delete_note", action: "call", effect: "allow" }] });
  assert.deepEqual(s.agents.map((x) => x.id).sort(), [a.id, b.id], "C is not assigned, so it is not affected");
  // Each agent's own rule (send: approve, delete: deny) is stricter than the proposal, so only what the agent left open could change: nothing.
  assert.deepEqual(s.changes, {});
  const assign = await simulatePolicy(db, { agentIds: [c.id], rules: [{ tool: "format_disk", action: "call", effect: "approve" }] });
  assert.deepEqual(assign.changes, { "deny->approve": 1 }, "assigning would open format_disk to approval for C");
  await db.close();
});

test("only this workspace's agents and policies, and invalid input is refused before anything is read", async () => {
  const db = await memoryDb();
  await db.run("INSERT INTO workspaces (id, name, created_at) VALUES ('ws_other', 'o', 0)");
  const mine = await history(db, "Mine");
  const theirs = await history(db, "Theirs", "ws_other");
  assert.equal(await code(simulatePolicy(db, { agentId: theirs.id, rules: RULES })), "agent_not_found");
  assert.equal(await code(simulatePolicy(db, { agentIds: [mine.id, theirs.id], rules: RULES })), "agent_not_found");
  assert.equal((await simulatePolicy(db, { agentId: theirs.id, rules: RULES }, "ws_other")).actions, 5);
  assert.equal(await code(simulatePolicy(db, { agentId: mine.id, rules: [{ tool: "x", action: "call", effect: "sometimes" }] })), "invalid_policy");
  assert.equal(await code(simulatePolicy(db, { agentId: mine.id, rules: RULES, days: 1000 })), "invalid_days");
  assert.equal(await code(simulatePolicy(db, { rules: RULES })), "invalid_target");
  await db.close();
});

test("by construction the simulator cannot run a tool: it imports no tool code and reads through the read-only wrapper", () => {
  const src = readFileSync(new URL("./simulate.ts", import.meta.url), "utf8");
  const imports = [...src.matchAll(/from "([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ["./db.ts", "./http.ts", "./policy.ts", "./session.ts", "./verification.ts"]);
  assert.match(src, /const q = readOnly\(db\)/);
  assert.ok(!/\bdb\.(all|get|run|exec|tx)\(/.test(src), "every query goes through the read-only wrapper");
});
