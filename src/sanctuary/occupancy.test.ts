// Placement is the contract between events and the Sanctuary: one rule, shared by the garden and the interiors.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createSeed } from "../lib/seed.ts";
import type { Agent, CheckIn } from "../lib/types";
import { occupants, RECENT_CHECK_IN, whereabouts } from "./occupancy.ts";

const now = 1_800_000_000_000;
const base = { enabled: true, paused: false, offline: false, working: false };

test("whereabouts follows state, in priority order", () => {
  assert.equal(whereabouts(base, now), "leisure");
  assert.equal(whereabouts({ ...base, working: true }, now), "study");
  assert.equal(whereabouts({ ...base, working: true, checkedInAt: now - 1000 }, now), "lounge");
  assert.equal(whereabouts({ ...base, working: true, checkedInAt: now - RECENT_CHECK_IN }, now), "study");
  assert.equal(whereabouts({ ...base, working: true, paused: true, checkedInAt: now }, now), "room");
  assert.equal(whereabouts({ ...base, offline: true }, now), "room");
  assert.equal(whereabouts({ ...base, enabled: false, paused: true }, now), "away");
});

test("occupants agree with whereabouts and never double-book an agent", () => {
  const agents: Agent[] = createSeed(now).agents.slice(0, 4);
  const [a, b, c, d] = agents.map((x) => x.id);
  agents[3] = { ...agents[3], status: "paused" };
  const tasks = { [a]: { taskId: "t1", title: "One", startedAt: now - 50 }, [b]: { taskId: "t2", title: "Two", startedAt: now - 90 } };
  const checkIns = [{ agentId: b, createdAt: now - 500 }, { agentId: c, createdAt: now - 10 * RECENT_CHECK_IN }] as CheckIn[];
  const at = (p: Parameters<typeof occupants>[0]) => occupants(p, agents, tasks, checkIns, now);
  assert.deepEqual(at("study"), [a]); // b has a task but just checked in
  assert.deepEqual(at("lounge"), [b]);
  assert.deepEqual(at("spa"), [c]);
  assert.deepEqual(at(`room:${d}`), [d]);
  assert.deepEqual(at(`room:${a}`), []);
  assert.deepEqual(at("garden"), []);
  const connected: Agent = { ...agents[0], id: "z", origin: "connected", lastSeenAt: now - 5 * 60_000 };
  assert.deepEqual(occupants("room:z", [connected], {}, [], now), ["z"]); // unheard from → offline → its room
});
