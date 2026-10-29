// Checks the event log's hash chain (migration 11): every event's hash must equal sha256(previous hash | its own content), recomputed here
// from the stored rows. A changed, removed or inserted event breaks the chain from that point on. What it cannot catch: someone who can
// write to the database and recomputes every later hash too. Against that, record the head hash somewhere else from time to time (the CLI
// prints it) and compare: a history rewritten after that point no longer ends in the hash you kept.
import { createHash } from "node:crypto";
import type { Q } from "./db.ts";

interface Row { seq: number; id: string; agent_id: string; type: string; at: number; actor: string; data: string; hash: string | null }

export async function verifyAudit(q: Q, batch = 2_000) {
  let prev: string | null = null, checked = 0, after = 0, firstChained: number | null = null;
  for (;;) {
    const rows = await q.all<Row>("SELECT seq, id, agent_id, type, at, actor, data, hash FROM events WHERE seq > ? ORDER BY seq LIMIT ?", after, batch);
    if (!rows.length) break;
    for (const r of rows) {
      after = Number(r.seq);
      if (r.hash === null) {
        // Before the chain existed (older events). Once the chain has started, a missing hash is itself a break.
        if (firstChained !== null) return { ok: false as const, checked, firstChained, brokenAt: after, reason: "an event without a hash inside the chain" };
        continue;
      }
      const expected: string = createHash("sha256").update(`${prev ?? ""}|${r.id}|${r.agent_id}|${r.type}|${r.at}|${r.actor}|${r.data}`, "utf8").digest("hex");
      // The first chained event may follow events removed by the demo's retention: its own hash is the anchor.
      if (firstChained !== null && r.hash !== expected) return { ok: false as const, checked, firstChained, brokenAt: after, reason: "an event was changed, removed or inserted here" };
      if (firstChained === null) firstChained = after;
      prev = r.hash;
      checked++;
    }
  }
  return { ok: true as const, checked, firstChained, head: prev };
}
