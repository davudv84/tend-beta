// The event log's hash chain: intact after normal use (single and batched inserts), and broken by any change, removal or insertion.
import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyAudit } from "./audit-chain.ts";
import { allowEventRemoval, memoryDb } from "./db.ts";
import { seedDemo } from "./demo.ts";
import { registerAgent, setPolicy } from "./repo.ts";

process.env.TEND_DEMO = "1"; // the demo seed writes hundreds of events in batched inserts

async function withHistory() {
  const db = await memoryDb();
  await seedDemo(db, Date.now()); // many events in batched inserts
  const r = await registerAgent(db, { name: "A", model: "m", provider: "Custom" });
  await setPolicy(db, r.agent.id, [{ tool: "t", action: "call", effect: "allow" }], "enforce");
  return db;
}
const tamper = (db: Awaited<ReturnType<typeof memoryDb>>, sql: string) => db.tx(async (q) => { await allowEventRemoval(q); await q.run(sql); });

test("normal use keeps the chain intact, batched inserts included, and gives a head hash to keep elsewhere", async () => {
  const db = await withHistory();
  const r = await verifyAudit(db, 7); // a small batch also walks page boundaries
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.checked > 20);
  assert.match((r as { head: string }).head, /^[0-9a-f]{64}$/);
  await db.close();
});

test("changing, removing or inserting an event is detected at that event", async () => {
  for (const [what, sql] of [
    ["changed data", "UPDATE events SET data = '{\"forged\":true}' WHERE seq = (SELECT seq FROM events ORDER BY seq LIMIT 1 OFFSET 5)"],
    ["changed type", "UPDATE events SET type = 'agent.resumed' WHERE seq = (SELECT seq FROM events ORDER BY seq LIMIT 1 OFFSET 6)"],
    ["removed", "DELETE FROM events WHERE seq = (SELECT seq FROM events ORDER BY seq LIMIT 1 OFFSET 7)"],
    ["hash wiped", "UPDATE events SET hash = NULL WHERE seq = (SELECT seq FROM events ORDER BY seq LIMIT 1 OFFSET 8)"],
  ] as const) {
    const db = await withHistory();
    await tamper(db, sql);
    const r = await verifyAudit(db);
    assert.equal(r.ok, false, what);
    await db.close();
  }
});

test("the log stays append-only for ordinary statements: no change without the maintenance flag", async () => {
  const db = await withHistory();
  await assert.rejects(db.run("UPDATE events SET data = '{}'"));
  await assert.rejects(db.run("DELETE FROM events"));
  assert.equal((await verifyAudit(db)).ok, true);
  await db.close();
});
