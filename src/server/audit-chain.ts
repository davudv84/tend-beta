// Checks the event log's hash chain (migrations 11 and 15): every event's hash must equal sha256(previous hash | ... | its own
// content), recomputed here from the stored rows. From migration 15 the event's own `seq` is bound into the hash too, so an event's
// position is covered, not only its content; verifyAudit applies the right formula per row using the boundary recorded in
// `meta['events.chain.v2_after']` (events with a greater seq are v2). A changed, removed or inserted event breaks the chain from
// that point on.
//
// Two things the bare chain cannot catch on its own, both needing database write access (a DB owner, who can also drop the trigger):
//   1. The FIRST chained row is an anchor: earlier events may have been pruned (demo retention), so its own hash cannot be
//      recomputed from a predecessor. Altering the oldest surviving event, or deleting a whole prefix of the log, leaves the later
//      chain and the head hash unchanged — invisible to a bare walk.
//   2. Deleting an interior event and recomputing every later hash produces a self-consistent chain.
// Against all of these, keep a checkpoint { firstSeq, firstHash, head, headSeq } somewhere outside TEND (the CLI prints it) and pass
// it back as `expected`: a moved/altered anchor, a cut prefix, or any rewrite up to the kept head no longer matches what you kept.
import { createHash } from "node:crypto";
import { meta, type Q } from "./db.ts";

interface Row { seq: number; id: string; agent_id: string; type: string; at: number; actor: string; data: string; hash: string | null }

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
/** The chained hash a row must have. v2 (seq > boundary) binds the row's own seq; v1 does not. Must match the DB trigger exactly. */
const chainHash = (prev: string | null, r: Row, v2: boolean) =>
  sha(v2 ? `${prev ?? ""}|${r.seq}|${r.id}|${r.agent_id}|${r.type}|${r.at}|${r.actor}|${r.data}`
        : `${prev ?? ""}|${r.id}|${r.agent_id}|${r.type}|${r.at}|${r.actor}|${r.data}`);
/** A predecessor-independent fingerprint of a row's own content, so the anchor can be pinned and checked even though its prev is gone. */
export const contentHash = (r: Pick<Row, "seq" | "id" | "agent_id" | "type" | "at" | "actor" | "data">) =>
  sha(`${r.seq}|${r.id}|${r.agent_id}|${r.type}|${r.at}|${r.actor}|${r.data}`);

/** A checkpoint to keep outside TEND and compare against later. All parts optional; give what you kept. */
export interface Checkpoint { firstSeq?: number; firstHash?: string; head?: string; headSeq?: number }
export type AuditResult =
  | { ok: true; checked: number; firstChained: number | null; firstHash: string | null; head: string | null; headSeq: number | null; gaps: number[] }
  | { ok: false; checked: number; firstChained: number | null; brokenAt: number; reason: string };

export async function verifyAudit(q: Q, batch = 2_000, expected?: Checkpoint): Promise<AuditResult> {
  const boundary = Number((await meta.get(q, "events.chain.v2_after")) ?? 0); // seq > boundary ⇒ v2 (seq bound into the hash)
  let prev: string | null = null, checked = 0, after = 0;
  let firstChained: number | null = null, firstHash: string | null = null, prevChainedSeq: number | null = null;
  let head: string | null = null, headSeq: number | null = null;
  const gaps: number[] = []; // seqs missing between chained rows (expected occasionally from rolled-back transactions; a hard signal only against a kept checkpoint)
  for (;;) {
    const rows = await q.all<Row>("SELECT seq, id, agent_id, type, at, actor, data, hash FROM events WHERE seq > ? ORDER BY seq LIMIT ?", after, batch);
    if (!rows.length) break;
    for (const r of rows) {
      r.seq = Number(r.seq);
      after = r.seq;
      if (r.hash === null) {
        // Before the chain existed (older events). Once the chain has started, a missing hash is itself a break.
        if (firstChained !== null) return { ok: false, checked, firstChained, brokenAt: r.seq, reason: "an event without a hash inside the chain" };
        continue;
      }
      if (firstChained === null) {
        // The anchor: its predecessor may be legitimately gone, so its chain hash is taken as given — but it is pinned by content.
        firstChained = r.seq;
        firstHash = contentHash(r);
        if (expected?.firstSeq !== undefined && r.seq !== expected.firstSeq)
          return { ok: false, checked, firstChained, brokenAt: r.seq, reason: `the oldest kept events were removed (log now starts at #${r.seq}, your checkpoint at #${expected.firstSeq})` };
        if (expected?.firstHash !== undefined && firstHash !== expected.firstHash)
          return { ok: false, checked, firstChained, brokenAt: r.seq, reason: "the oldest kept event was altered (its content no longer matches your checkpoint)" };
      } else {
        if (prevChainedSeq !== null && r.seq !== prevChainedSeq + 1) {
          for (let s = prevChainedSeq + 1; s < r.seq; s++) gaps.push(s);
          // A gap below a kept head means an event was removed and the chain recomputed: with a checkpoint that is a hard break.
          if (expected?.headSeq !== undefined && r.seq <= expected.headSeq)
            return { ok: false, checked, firstChained, brokenAt: r.seq, reason: `events are missing before your checkpoint (sequence gap at #${prevChainedSeq + 1})` };
        }
        if (r.hash !== chainHash(prev, r, r.seq > boundary))
          return { ok: false, checked, firstChained, brokenAt: r.seq, reason: "an event was changed, removed or inserted here" };
      }
      prevChainedSeq = r.seq;
      prev = r.hash;
      head = r.hash;
      headSeq = r.seq;
      checked++;
    }
  }
  // The kept head must still be the hash stored at that seq: catches any rewrite of the history up to the checkpoint.
  if (expected?.headSeq !== undefined && expected.head !== undefined) {
    const at = await q.get<{ hash: string | null }>("SELECT hash FROM events WHERE seq = ?", expected.headSeq);
    if (!at) return { ok: false, checked, firstChained, brokenAt: expected.headSeq, reason: `your checkpoint head (#${expected.headSeq}) is gone` };
    if (at.hash !== expected.head) return { ok: false, checked, firstChained, brokenAt: expected.headSeq, reason: "the history up to your checkpoint was rewritten (head hash differs)" };
  }
  return { ok: true, checked, firstChained, firstHash, head, headSeq, gaps };
}
