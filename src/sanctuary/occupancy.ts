// Who is inside each building, derived only from agent state. Shared by the renderer and the panels
// so the figures drawn in a room and the names listed beside it always agree.
import { isOnline } from "../lib/projection.ts";
import type { Dict } from "../i18n/en.ts";
import type { Agent, CheckIn, Task } from "../lib/types";

export type Place = "garden" | "study" | "lounge" | "spa" | `room:${string}`;
export type InteriorKind = Exclude<Place, "garden" | `room:${string}`> | "room";

/** A check-in this recent puts the agent in the lounge. */
export const RECENT_CHECK_IN = 60_000;

export type Whereabouts = "away" | "room" | "lounge" | "study" | "leisure";

/** The one rule that places an agent. The garden figures and the interiors both use it, so they always agree. */
export function whereabouts(s: { enabled: boolean; paused: boolean; offline: boolean; working: boolean; checkedInAt?: number }, now: number): Whereabouts {
  if (!s.enabled) return "away";
  if (s.paused || s.offline) return "room";
  if (s.checkedInAt && now - s.checkedInAt < RECENT_CHECK_IN) return "lounge";
  if (s.working) return "study";
  return "leisure";
}

export const kindOf = (p: Place): InteriorKind | "garden" => (p.startsWith("room:") ? "room" : (p as "garden" | "study" | "lounge" | "spa"));
export const roomAgent = (p: Place) => (p.startsWith("room:") ? p.slice(5) : null);

export function placeName(t: Dict, p: Place, agents: Agent[]) {
  const id = roomAgent(p);
  if (id) return t.places.room(agents.find((a) => a.id === id)?.name ?? t.common.agent);
  return t.places[p as "garden" | "study" | "lounge" | "spa"];
}

/** Agent ids by seat, in seat order. Seats beyond what an interior has are simply not drawn. */
export function occupants(place: Place, agents: Agent[], tasks: Record<string, Task>, checkIns: CheckIn[], now: number): string[] {
  const kind = kindOf(place);
  if (kind === "garden") return [];
  const latest = new Map<string, number>();
  for (const c of checkIns) if (!latest.has(c.agentId)) latest.set(c.agentId, c.createdAt);
  const where = (a: Agent) =>
    whereabouts({ enabled: a.integrationEnabled, paused: a.status === "paused", offline: !isOnline(a, now), working: !!tasks[a.id], checkedInAt: latest.get(a.id) }, now);
  if (kind === "room") return agents.filter((a) => a.id === roomAgent(place) && where(a) === "room").map((a) => a.id);
  const here = agents.filter((a) => where(a) === (kind === "spa" ? "leisure" : kind));
  if (kind === "study") here.sort((a, b) => tasks[a.id].startedAt - tasks[b.id].startedAt);
  if (kind === "lounge") here.sort((a, b) => latest.get(b.id)! - latest.get(a.id)!);
  return here.map((a) => a.id);
}
