// Server-side demonstration environment. Demo agents never call a model: their events come from
// this file, are stored with actor "simulation", and are labelled simulated everywhere they appear.
// It advances lazily — each read catches up on the time since the last one — so no background job is needed.
// Several server instances may read at once: an advisory lock lets exactly one of them advance the clock.
import type { EventType } from "../lib/projection.ts";
import { createSeed, simulateCheckIn } from "../lib/seed.ts";
import type { Agent } from "../lib/types";
import { config } from "./config.ts";
import { allowEventRemoval, LOCK, meta, type DB, type Q } from "./db.ts";
import { allAgents, insertAgent, insertEvent, insertEvents } from "./repo.ts";

const S = 1000;
const MAX_CATCH_UP = 20 * 60 * S;
const RETENTION = 32 * 24 * 60 * 60 * S;

const TASKS: Record<string, [string, string, string][]> = {
  atlas: [
    ["Draft brief: regional grid storage", "Policy team request · 3 sources", "Brief drafted, 1,240 words, 6 citations."],
    ["Summarize papers on heat pumps", "Four peer-reviewed papers", "Summary ready; two papers disagree on payback period."],
    ["Fact-check transport brief", "Requested by the editor", "11 claims checked, 1 corrected."],
  ],
  nova: [
    ["Triage incoming tickets", "Queue: 14 new", "14 tickets classified; 3 routed to billing."],
    ["Draft reply: billing question", "Ticket #48213", "Draft ready for a human to send."],
    ["Draft reply: shipping delay", "Ticket #48231", "Draft ready; flagged missing tracking number."],
  ],
  echo: [
    ["Review PR #1287 — retry logic", "repo: payments-service", "4 comments; suggested a test for the backoff cap."],
    ["Review PR #1291 — docs", "repo: developer-docs", "Approved with 2 nits."],
    ["Review PR #1293 — schema change", "repo: warehouse", "Requested changes: missing migration rollback."],
  ],
  sable: [
    ["Summarize Q3 board memo", "18 pages", "One-page summary delivered."],
    ["Summarize interview transcript", "47 minutes", "Summary and five quotes delivered."],
  ],
  iris: [["Schedule nightly pipeline", "6 jobs", "Jobs scheduled."]],
  kestrel: [
    ["Find a slot: design review", "5 attendees, 2 time zones", "Proposed Thursday 15:00 UTC."],
    ["Reschedule weekly sync", "Organizer is travelling", "Two alternatives proposed."],
    ["Find a slot: candidate interview", "3 interviewers", "Proposed Tuesday 10:30."],
  ],
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const ms = (t: number) => Math.round(t);

/** Inserts the demo agents and a 30-day history, once, whichever instance gets there first. */
export async function seedDemo(db: DB, now: number) {
  if (!config.demo || (await meta.get(db, "demo.seeded"))) return;
  await db.tx(async (q) => {
    await q.get("SELECT pg_advisory_xact_lock(?)", LOCK.DEMO);
    await q.lockEvents();
    if (await meta.get(q, "demo.seeded")) return;
    const seed = createSeed(now);
    for (const a of seed.agents) await insertAgent(q, a);
    type Row = { at: number; agentId: string; type: EventType; actor: "human" | "simulation"; data: object; id?: string };
    const events: Row[] = [];
    const reviews: unknown[][] = [];
    for (const a of seed.agents) events.push({ at: a.connectedAt, agentId: a.id, type: "agent.registered", actor: "human", data: { agent: a } });
    for (const c of seed.checkIns) {
      events.push({ id: c.id, at: c.createdAt, agentId: c.agentId, type: "check_in", actor: "simulation", data: { responses: c.responses, feedback: c.feedback, context: c.context, ...(c.reflection && { reflection: c.reflection }), ...(c.adjustment && { adjustment: c.adjustment }) } });
      if (c.review) reviews.push([c.id, c.agentId, c.review.status, c.adjustment?.permission ?? null, c.review.decidedAt ? ms(c.review.decidedAt) : null]);
      if (c.review?.decidedAt) {
        const { status, decidedAt, note } = c.review;
        events.push({ at: decidedAt, agentId: c.agentId, type: "review.decided", actor: "human", data: { reviewId: c.id, status, ...(note && { note }) } });
        if (status === "approved" && c.adjustment?.permission)
          events.push({ at: decidedAt + 1000, agentId: c.agentId, type: "permission.granted", actor: "human", data: { permission: c.adjustment.permission, reviewId: c.id } });
      }
    }
    for (const l of seed.log) if (l.type === "agent_paused") events.push({ at: l.at, agentId: l.agentId, type: "agent.paused", actor: "human", data: { note: l.note } });
    // Stored in time order, so sequence numbers follow what happened.
    await insertEvents(q, events.sort((a, b) => a.at - b.at));
    for (let i = 0; i < reviews.length; i += 200) {
      const chunk = reviews.slice(i, i + 200);
      await q.run(`INSERT INTO reviews (id, agent_id, status, permission, decided_at) VALUES ${chunk.map(() => "(?, ?, ?, ?, ?)").join(", ")}`, ...chunk.flat());
    }
    await meta.set(q, "demo.seeded", String(now));
    await meta.set(q, "demo.tick", String(now - 15 * 60 * S));
    await meta.set(q, "demo.next_checkin", String(now + 20 * S));
  });
}

interface Phase { phase: "idle" | "working"; until: number; taskId?: string; summary?: string }

/** Generates the demo agents' events between the last read and `now`, then records the new tick. */
export async function advanceDemo(db: DB, now: number) {
  if (!config.demo) return;
  await seedDemo(db, now);
  if (now - Number((await meta.get(db, "demo.tick")) ?? now) < 1500) return;
  await db.tx(async (q) => {
    // Another instance is already catching up: its events will reach us on the next poll.
    if (!(await q.get<{ ok: boolean }>("SELECT pg_try_advisory_xact_lock(?) AS ok", LOCK.DEMO))?.ok) return;
    await q.lockEvents();
    const last = Number((await meta.get(q, "demo.tick")) ?? now);
    if (now - last < 1500) return;
    const from = Math.max(last, now - MAX_CATCH_UP);
    const demo = (await allAgents(q)).filter((a) => a.origin === "demo");
    const live = (a: Agent) => a.integrationEnabled && a.status !== "paused";
    const out: { at: number; agent: Agent; type: "task.started" | "task.completed"; data: object }[] = [];

    for (const a of demo) {
      const key = `demo.task.${a.id}`;
      if (!live(a)) {
        await meta.set(q, key, JSON.stringify({ phase: "idle", until: now + 30 * S }));
        continue;
      }
      let s = JSON.parse((await meta.get(q, key)) ?? JSON.stringify({ phase: "idle", until: from + rand(3, 40) * S })) as Phase;
      if (s.until < from - MAX_CATCH_UP) s = { phase: "idle", until: from + rand(3, 30) * S };
      const quiet = a.status === "idle";
      while (s.until <= now) {
        if (s.phase === "working") {
          out.push({ at: s.until, agent: a, type: "task.completed", data: { taskId: s.taskId, ...(s.summary && { summary: s.summary }) } });
          s = { phase: "idle", until: s.until + rand(quiet ? 70 : 20, quiet ? 160 : 65) * S };
        } else {
          const [title, detail, summary] = pick(TASKS[a.id] ?? [["Routine task", "", "Done."]]);
          const taskId = `t_${Math.floor(s.until / 1000).toString(36)}`;
          out.push({ at: s.until, agent: a, type: "task.started", data: { taskId, title, detail } });
          s = { phase: "working", until: s.until + rand(quiet ? 15 : 25, quiet ? 40 : 70) * S, taskId, summary };
        }
      }
      await meta.set(q, key, JSON.stringify(s));
    }
    // Keep events in time order so seq order matches what happened.
    out.sort((a, b) => a.at - b.at);
    for (const e of out) await insertEvent(q, { agentId: e.agent.id, type: e.type, actor: "simulation", at: e.at, data: e.data });

    // Periodic check-ins, occasionally flagged for review (at most five open at a time).
    let next = Number((await meta.get(q, "demo.next_checkin")) ?? now);
    while (next <= now) {
      const a = demo.filter(live);
      if (a.length) await checkIn(q, pick(a), next, false);
      next += rand(40, 85) * S;
    }
    await meta.set(q, "demo.next_checkin", String(next));

    // Answer human requests addressed to demo agents after a short, plainly simulated delay.
    const asks = await q.all<{ id: string; agent_id: string; requested_at: number; delivered_at: number | null }>(
      "SELECT a.id, a.agent_id, a.requested_at, a.delivered_at FROM asks a JOIN agents g ON g.id = a.agent_id WHERE g.origin = 'demo' AND a.answered_at IS NULL",
    );
    for (const ask of asks) {
      const agent = demo.find((a) => a.id === ask.agent_id);
      if (!ask.delivered_at && ask.requested_at + 900 <= now) {
        await q.run("UPDATE asks SET delivered_at = ? WHERE id = ?", ask.requested_at + 900, ask.id);
        await insertEvent(q, { agentId: ask.agent_id, type: "checkin.request.delivered", actor: "system", at: ask.requested_at + 900, data: { askId: ask.id } });
      }
      if (agent && live(agent) && ask.requested_at + 3500 <= now) {
        await checkIn(q, agent, ask.requested_at + 3500, true);
        await q.run("UPDATE asks SET answered_at = ? WHERE id = ?", ask.requested_at + 3500, ask.id);
      }
    }

    if (now - Number((await meta.get(q, "demo.pruned")) ?? 0) > 3600 * S) {
      await allowEventRemoval(q);
      await q.run("DELETE FROM events WHERE actor = 'simulation' AND at < ?", ms(now - RETENTION));
      await meta.set(q, "demo.pruned", String(now));
    }
    await meta.set(q, "demo.tick", String(now));
  });
}

async function checkIn(q: Q, agent: Agent, at: number, requested: boolean) {
  const open = (await q.get<{ n: number }>("SELECT COUNT(*) AS n FROM reviews WHERE status = 'pending'"))!.n;
  const c = simulateCheckIn(agent.id, at, open < 5, requested);
  const e = await insertEvent(q, {
    agentId: agent.id, type: "check_in", actor: "simulation", at,
    data: { responses: c.responses, feedback: c.feedback, context: c.context, ...(c.reflection && { reflection: c.reflection }), ...(c.adjustment && { adjustment: c.adjustment }) },
  });
  if (c.review) await q.run("INSERT INTO reviews (id, agent_id, status, permission) VALUES (?, ?, 'pending', ?)", e.id, agent.id, c.adjustment?.permission ?? null);
}

/** Removes all demo agents and their history, then seeds them again. Connected agents are untouched. */
export async function resetDemo(db: DB, now: number) {
  await db.tx(async (q) => {
    await q.get("SELECT pg_advisory_xact_lock(?)", LOCK.DEMO);
    await q.lockEvents();
    await allowEventRemoval(q); // the demo agents' events go with them (ON DELETE CASCADE)
    await q.run("DELETE FROM agents WHERE origin = 'demo'");
    await q.run("DELETE FROM meta WHERE key LIKE 'demo.%'");
  });
  await seedDemo(db, now);
}
