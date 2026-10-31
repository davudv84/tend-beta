// Read models for the UI: a full snapshot, then incremental events by sequence number.
import { applyEvents, emptyProjection } from "../lib/projection.ts";
import type { Viewer } from "./auth.ts";
import { sweepExpired } from "./authz.ts";
import type { DB } from "./db.ts";
import { advanceDemo } from "./demo.ts";
import { HttpError } from "./http.ts";
import { visibleTo } from "./redact.ts";
import { allAgents, eventsAfter, keyPrefixes, lastSeq, recentEvents } from "./repo.ts";
import { DEFAULT_WORKSPACE } from "./session.ts";

const WINDOW = 31 * 24 * 60 * 60 * 1000;

export function assertCanView(v: Viewer) {
  if (v.role !== "operator" && !v.public) throw new HttpError(401, "sign_in_required", "This Tend instance is private. Sign in as an operator to view it.");
}

/** Only the viewer's workspace: a user's own, or the default one for the admin and for public visitors. Visitors see demo agents and connected agents an operator marked public. */
async function visible(db: DB, v: Viewer) {
  const agents = await allAgents(db, v.workspace ?? DEFAULT_WORKSPACE);
  return v.role === "operator" ? agents : agents.filter((a) => a.origin === "demo" || a.public);
}

export async function snapshot(db: DB, v: Viewer, now = Date.now()) {
  assertCanView(v);
  await advanceDemo(db, now);
  // So the dashboard shows an authorization as expired once it is, not when the agent next calls.
  await sweepExpired(db, now);
  // Read the cursor first: anything committed after it arrives with the next poll, never lost.
  const seq = await lastSeq(db);
  const agents = await visible(db, v);
  const ids = new Set(agents.map((a) => a.id));
  const events = visibleTo((await recentEvents(db, now - WINDOW, 12_000, [...ids])).filter((e) => e.seq <= seq), v, agents);
  return {
    viewer: v,
    seq,
    now,
    projection: applyEvents(emptyProjection(agents), events),
    // Key prefixes help operators tell keys apart; the keys themselves are never stored.
    ...(v.role === "operator" && { keys: await keyPrefixes(db, v.workspace ?? DEFAULT_WORKSPACE) }),
  };
}

export async function since(db: DB, v: Viewer, seq: number, now = Date.now()) {
  assertCanView(v);
  await advanceDemo(db, now);
  await sweepExpired(db, now);
  const agents = await visible(db, v);
  const ids = new Set(agents.map((a) => a.id));
  const batch = await eventsAfter(db, seq, 500);
  return {
    seq: batch.length ? batch[batch.length - 1].seq : seq,
    more: batch.length === 500,
    now,
    events: visibleTo(batch.filter((e) => ids.has(e.agentId)), v, agents),
    // Presence changes on every authenticated request, without an event.
    presence: Object.fromEntries(agents.filter((a) => a.origin === "connected").map((a) => [a.id, { lastSeenAt: a.lastSeenAt ?? null, disconnectedAt: a.disconnectedAt ?? null }])),
  };
}
