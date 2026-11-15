// The event log's hash chain: intact after normal use (single and batched inserts), and broken by any change, removal or insertion.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { verifyAudit, type Checkpoint } from "./audit-chain.ts";
import { allowEventRemoval, MIGRATIONS, memoryDb, pglite } from "./db.ts";
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

const checkpointOf = (r: Awaited<ReturnType<typeof verifyAudit>>): Checkpoint => {
  assert.equal(r.ok, true);
  const o = r as Extract<typeof r, { ok: true }>;
  return { firstSeq: o.firstChained!, firstHash: o.firstHash!, headSeq: o.headSeq!, head: o.head! };
};

test("a kept checkpoint catches an altered OLDEST event — which a bare walk, and the head hash, miss", async () => {
  const db = await withHistory();
  const cp = checkpointOf(await verifyAudit(db));
  // Alter the oldest event's data but LEAVE its stored hash: the chain still links and the head is unchanged.
  await tamper(db, "UPDATE events SET data = '{\"evil\":1}' WHERE seq = (SELECT MIN(seq) FROM events WHERE hash IS NOT NULL)");
  const bare = await verifyAudit(db);
  assert.equal(bare.ok, true, "the anchor is unverifiable without a checkpoint (this is the gap being closed)");
  assert.equal((bare as Extract<typeof bare, { ok: true }>).head, cp.head, "head hash is unchanged, so it misses it too");
  const caught = await verifyAudit(db, 2_000, cp);
  assert.equal(caught.ok, false);
  assert.match((caught as Extract<typeof caught, { ok: false }>).reason, /oldest kept event was altered/);
  await db.close();
});

test("a kept checkpoint catches a deleted PREFIX of the log — which a bare walk, and the head hash, miss", async () => {
  const db = await withHistory();
  const cp = checkpointOf(await verifyAudit(db));
  await tamper(db, "DELETE FROM events WHERE seq IN (SELECT seq FROM events ORDER BY seq LIMIT 3)");
  const bare = await verifyAudit(db);
  assert.equal(bare.ok, true, "the next survivor becomes the anchor, so a bare walk still passes (the gap)");
  assert.equal((bare as Extract<typeof bare, { ok: true }>).head, cp.head, "head hash is unchanged by a prefix deletion");
  const caught = await verifyAudit(db, 2_000, cp);
  assert.equal(caught.ok, false);
  assert.match((caught as Extract<typeof caught, { ok: false }>).reason, /oldest kept events were removed/);
  await db.close();
});

test("a kept checkpoint catches an INTERIOR event deleted and the chain recomputed (the sophisticated rewrite)", async () => {
  const db = await withHistory();
  const cp = checkpointOf(await verifyAudit(db));
  const rows = await db.all<{ seq: number; id: string; agent_id: string; type: string; at: number; actor: string; data: string }>(
    "SELECT seq, id, agent_id, type, at, actor, data FROM events ORDER BY seq");
  const dropAt = rows[Math.floor(rows.length / 2)].seq; // an interior event
  await db.tx(async (q) => {
    await allowEventRemoval(q);
    await q.run("DELETE FROM events WHERE seq = ?", dropAt);
    // Recompute every surviving hash forward exactly like the v2 trigger, so the chain re-links.
    let prev = "";
    for (const r of rows.filter((x) => x.seq !== dropAt)) {
      const h = createHash("sha256").update(`${prev}|${r.seq}|${r.id}|${r.agent_id}|${r.type}|${r.at}|${r.actor}|${r.data}`, "utf8").digest("hex");
      await q.run("UPDATE events SET hash = ? WHERE seq = ?", h, r.seq);
      prev = h;
    }
  });
  assert.equal((await verifyAudit(db)).ok, true, "the recomputed chain is self-consistent");
  const caught = await verifyAudit(db, 2_000, cp);
  assert.equal(caught.ok, false, "but it no longer leads to the head you kept, or a seq gap shows before it");
  await db.close();
});

test("events written after the seq-binding migration verify across the v1→v2 boundary, and tampering either side is caught", async () => {
  const db = await pglite(); // raw, so we can stop one migration short of seq-binding
  for (let i = 0; i < MIGRATIONS.length - 1; i++) await db.exec(MIGRATIONS[i]);
  await db.run("INSERT INTO agents (id, profile, origin, created_at, workspace_id) VALUES ('a', '{}', 'connected', 0, 'default')");
  const add = (id: string, data = "{}") => db.run("INSERT INTO events (id, agent_id, type, at, actor, data) VALUES (?, 'a', 'test', 1, 'system', ?)", id, data);
  for (let i = 0; i < 5; i++) await add(`v1-${i}`); // v1 hashes (no seq), under the old trigger
  await db.exec(MIGRATIONS[MIGRATIONS.length - 1]); // records the boundary, swaps the trigger to v2
  for (let i = 0; i < 5; i++) await add(`v2-${i}`); // v2 hashes (seq bound in)
  assert.equal((await verifyAudit(db)).ok, true, "the whole chain verifies across the boundary");
  // tamper a pre-boundary (v1) interior event
  await tamper(db, "UPDATE events SET data = '{\"x\":1}' WHERE id = 'v1-2'");
  assert.equal((await verifyAudit(db)).ok, false, "a v1-side change is caught");
  await db.close();
  // and a post-boundary (v2) change, on a fresh build
  const db2 = await pglite();
  for (let i = 0; i < MIGRATIONS.length - 1; i++) await db2.exec(MIGRATIONS[i]);
  await db2.run("INSERT INTO agents (id, profile, origin, created_at, workspace_id) VALUES ('a', '{}', 'connected', 0, 'default')");
  await db2.run("INSERT INTO events (id, agent_id, type, at, actor, data) VALUES ('v1-only', 'a', 'test', 1, 'system', '{}')");
  await db2.exec(MIGRATIONS[MIGRATIONS.length - 1]);
  for (let i = 0; i < 3; i++) await db2.run("INSERT INTO events (id, agent_id, type, at, actor, data) VALUES (?, 'a', 'test', 1, 'system', '{}')", `v2-${i}`);
  await db2.tx(async (q) => { await allowEventRemoval(q); await q.run("UPDATE events SET data = '{\"x\":1}' WHERE id = 'v2-1'"); });
  assert.equal((await verifyAudit(db2)).ok, false, "a v2-side change is caught");
  await db2.close();
});
