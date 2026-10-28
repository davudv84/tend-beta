// Agent figures and the rules that place them. A figure's location encodes a system state:
// study = processing a task, lounge = just submitted a check-in, room = paused,
// garden and pools = idle. Movement is local and costs nothing; it implies no inner experience.
import { blend, hash, mix, put, rgb, scale, sx, sy, type Target } from "./engine.ts";
import { whereabouts } from "./occupancy.ts";
import { edges, nodes, spots, type Node, type Spot, type SpotKind } from "./scene.ts";

// ---- identity ----------------------------------------------------------------------------------

export type Headwear = "plain" | "hood" | "kasa" | "band" | "tassel" | "crest";
export interface Identity { robe: number; trim: number; head: Headwear }

const IDENTITY: Record<string, Identity> = {
  atlas: { robe: 0x9c5b3e, trim: 0xe3d3b0, head: "hood" },
  nova: { robe: 0x3e5868, trim: 0xc8b48a, head: "kasa" },
  echo: { robe: 0x56683f, trim: 0xd8c59a, head: "band" },
  sable: { robe: 0x3a3532, trim: 0xc08a50, head: "crest" },
  iris: { robe: 0x6e5574, trim: 0xe3d5bf, head: "tassel" },
  kestrel: { robe: 0xa8853f, trim: 0x384636, head: "plain" },
};

export function identity(id: string): Identity {
  if (IDENTITY[id]) return IDENTITY[id];
  const robes = [0x5d4b3c, 0x48584a, 0x5a4a5e, 0x6b5a3a];
  return { robe: robes[Math.floor(hash(id.length, id.charCodeAt(0), 81) * robes.length)], trim: 0xe0d2b6, head: "plain" };
}

// ---- sprites ---------------------------------------------------------------------------------
// K lantern frame · L paper · l paper shade · G light · R robe · r shadow · H highlight · T trim · F feet

const HEAD = ["...K...", "..LLL..", "..LGL..", "..lLl..", "...K..."];
const BODY = [
  "..HRr..",
  ".HRRRr.",
  "HRRTRrr",
  ".RRTRr.",
  ".RRTRr.",
  ".RRRRr.",
  ".RRRRr.",
  ".RRRrr.",
];
const BACK = ["..HRr..", ".HRRRr.", "HRRRRrr", ".RRRRr.", ".RTTTr.", ".RRRRr.", ".RRRRr.", ".RRRrr."];
const FEET = { stand: ["rRRRrrr", "..F.F.."], a: ["rRRRrr.", ".F...F."], b: [".rRRRrr", "..FF..."] };
const SIT = ["..HRr..", ".HRRRr.", "HRRTRrr", "RRRTRRr", "rRRRRrr", ".rrrrr."];
const SIT_BACK = ["..HRr..", ".HRRRr.", "HRRRRrr", "RRTTTRr", "rRRRRrr", ".rrrrr."];

const HATS: Record<Headwear, string[]> = {
  plain: [],
  hood: ["..RRR..", ".R...R.", ".R...R.", ".R...R.", ".RR.RR."],
  kasa: ["..SSS..", ".SSSSS.", "sSSSSSs"],
  band: ["", "", "", "..TTT.."],
  tassel: ["", "", "", "", ".T.....", ".T.....", ".T....."],
  crest: ["...T...", "..TKT.."],
};
/** Rows above the lantern finial a hat occupies. */
const HAT_LIFT: Record<Headwear, number> = { plain: 0, hood: 0, kasa: 1, band: 0, tassel: 0, crest: 2 };

export type Pose = "stand" | "a" | "b" | "sit";

export function spriteRows(pose: Pose, back: boolean) {
  if (pose === "sit") return [...HEAD, ...(back ? SIT_BACK : SIT)];
  return [...HEAD, ...(back ? BACK : BODY), ...FEET[pose]];
}

const K = rgb(0x2a211b), L = rgb(0xe6dcc4), Ls = rgb(0xc3b597), F = rgb(0x221c18), S = rgb(0xb39663), Ss = rgb(0x8c7347);

export function palette(id: string, light: number) {
  const me = identity(id);
  const R = rgb(me.robe);
  return { K, L, l: Ls, G: light, R, r: scale(R, 0.7), H: mix(R, rgb(0xffffff), 0.2), T: rgb(me.trim), F, S, s: Ss } as Record<string, number>;
}

const OUTLINE = rgb(0x17130f);

/** Draws a figure with its feet at (X, Y), outlined so it reads against busy ground. */
export function drawFigure(f: Target, id: string, pose: Pose, back: boolean, flip: boolean, X: number, Y: number, d: number, light: number, test = true) {
  const pal = palette(id, light), me = identity(id);
  const body = spriteRows(pose, back);
  const lift = HAT_LIFT[me.head];
  const top = Y - body.length + 1;
  // Compose body and headwear into one grid, then outline it.
  const rows = body.length + lift;
  const grid: string[][] = Array.from({ length: rows }, () => Array(7).fill("."));
  const stamp = (row: string, gy: number) => {
    for (let i = 0; i < row.length; i++) if (row[i] !== ".") grid[gy][i] = row[i];
  };
  body.forEach((row, j) => stamp(row, j + lift));
  HATS[me.head].forEach((row, j) => row && stamp(row, j));
  const gx0 = X - 3, gy0 = top - lift;
  const cell = (i: number, j: number) => j >= 0 && j < rows && i >= 0 && i < 7 && grid[j][flip ? 6 - i : i] !== ".";
  for (let j = -1; j <= rows; j++)
    for (let i = -1; i <= 7; i++) {
      if (cell(i, j)) continue;
      if (cell(i - 1, j) || cell(i + 1, j) || cell(i, j - 1) || cell(i, j + 1)) put(f, gx0 + i, gy0 + j, OUTLINE, d - 0.01, test);
    }
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < 7; i++) {
      const ch = grid[j][flip ? 6 - i : i];
      if (ch !== ".") put(f, gx0 + i, gy0 + j, pal[ch], d, test);
    }
  return { glowY: top + 2, top: gy0 };
}

/** Soft contact shadow under a figure. */
export function footShadow(f: Target, X: number, Y: number, d: number) {
  for (let dy = 0; dy <= 1; dy++)
    for (let dx = -4; dx <= 4; dx++) if (Math.abs(dx) < 4 - dy * 2 || dy === 0) blend(f, X + dx, Y + dy, OUTLINE, 0.35, d - 0.7);
}

// ---- pathfinding -------------------------------------------------------------------------------

const adj: Record<string, string[]> = {};
for (const [a, b] of edges) {
  (adj[a] ??= []).push(b);
  (adj[b] ??= []).push(a);
}
const dist = (a: Node, b: Node) => Math.hypot(a.x - b.x, a.y - b.y);

function route(from: string, to: string): string[] {
  const best: Record<string, number> = { [from]: 0 }, prev: Record<string, string> = {}, open = [from];
  while (open.length) {
    open.sort((a, b) => best[a] - best[b]);
    const cur = open.shift()!;
    if (cur === to) break;
    for (const n of adj[cur] ?? []) {
      const c = best[cur] + dist(nodes[cur], nodes[n]);
      if (c < (best[n] ?? Infinity)) {
        best[n] = c;
        prev[n] = cur;
        open.push(n);
      }
    }
  }
  const out = [to];
  while (out[0] !== from && prev[out[0]]) out.unshift(prev[out[0]]);
  return out[0] === from ? out : [to];
}

// ---- behaviour -------------------------------------------------------------------------------

export interface AgentState {
  id: string;
  index: number;
  enabled: boolean;
  paused: boolean;
  /** Connected agent not heard from recently, or disconnected. */
  offline: boolean;
  working: boolean;
  pending: boolean;
  latestCheckIn?: { id: string; at: number };
}

export type Kind = SpotKind | "away";

export interface Actor {
  id: string;
  x: number;
  y: number;
  z: number;
  spot: Spot;
  kind: Kind;
  path: (Node & { id?: string })[];
  lastNode: string;
  settled: boolean;
  hidden: boolean;
  face: 1 | -1;
  back: boolean;
  dwell: number;
  walk: number;
  flashAt: number;
  seenCheckIn?: string;
  /** Where the lantern light was last drawn, for the glow pass. */
  gy: number;
}

const SPEED = 1.45;

export class Residents {
  actors = new Map<string, Actor>();
  private bornAt: number;
  constructor(bornAt: number) {
    this.bornAt = bornAt;
  }

  private desired(s: AgentState, now: number): Kind {
    return whereabouts({ ...s, checkedInAt: s.latestCheckIn?.at }, now);
  }

  private pick(kind: Kind, s: AgentState, exclude?: Spot): Spot {
    if (kind === "room" || kind === "away") return spots.find((p) => p.kind === "room" && p.room === s.index % 6)!;
    const taken = new Set([...this.actors.values()].filter((a) => a.id !== s.id).map((a) => a.spot.id));
    const free = spots.filter((p) => p.kind === kind && !taken.has(p.id) && p !== exclude);
    const pool = free.length ? free : spots.filter((p) => p.kind === kind);
    return pool[Math.floor(Math.random() * pool.length)];
  }

  private place(a: Actor, spot: Spot) {
    Object.assign(a, { x: spot.x, y: spot.y, z: spot.z, spot, path: [], settled: true, lastNode: spot.link, face: spot.face, back: !!spot.back });
  }

  private goTo(a: Actor, spot: Spot, teleport: boolean) {
    if (teleport) return this.place(a, spot);
    const from = a.settled ? a.spot.link : (a.path.find((p) => p.id)?.id ?? a.lastNode);
    a.spot = spot;
    const ids = route(from, spot.link);
    a.path = [...ids.map((id) => ({ ...nodes[id], id })), spot];
    a.settled = false;
  }

  update(states: AgentState[], now: number, dt: number, teleport: boolean) {
    const seen = new Set<string>();
    for (const s of states) {
      seen.add(s.id);
      let a = this.actors.get(s.id);
      const latest = s.latestCheckIn;
      const kind = this.desired(s, now);
      if (!a) {
        const spot = this.pick(kind, s);
        a = { id: s.id, x: 0, y: 0, z: 0, spot, kind, path: [], lastNode: spot.link, settled: true, hidden: kind === "away", face: 1, back: false, dwell: now + 6000 + Math.random() * 14000, walk: 0, flashAt: 0, seenCheckIn: latest?.id, gy: 0 };
        this.place(a, spot);
        this.actors.set(s.id, a);
        continue;
      }
      // A check-in that arrives while the view is open also flashes the figure's lantern.
      if (latest && latest.id !== a.seenCheckIn) {
        a.seenCheckIn = latest.id;
        if (latest.at > this.bornAt && s.enabled && !s.paused && !s.offline) a.flashAt = now;
      }
      const want = this.desired(s, now);
      if (want !== "away") a.hidden = false;
      const restless = want === "leisure" && a.settled && now > a.dwell;
      if (want !== a.kind || restless) {
        a.kind = want;
        a.dwell = now + 9000 + Math.random() * 16000;
        this.goTo(a, this.pick(want, s, a.spot), teleport);
      }
      this.step(a, dt);
      if (a.kind === "away" && a.settled) a.hidden = true;
    }
    for (const id of this.actors.keys()) if (!seen.has(id)) this.actors.delete(id);
  }

  private step(a: Actor, dt: number) {
    if (a.settled) return;
    let budget = SPEED * dt;
    while (budget > 0 && a.path.length) {
      const next = a.path[0];
      const dx = next.x - a.x, dy = next.y - a.y, d = Math.hypot(dx, dy);
      if (d > 1e-3) {
        a.face = dx - dy >= 0 ? 1 : -1;
        a.back = dx + dy < -0.05;
      }
      if (d <= budget) {
        a.x = next.x;
        a.y = next.y;
        a.z = next.z;
        budget -= d;
        if (next.id) a.lastNode = next.id;
        a.path.shift();
      } else {
        const k = budget / d;
        a.x += dx * k;
        a.y += dy * k;
        a.z += (next.z - a.z) * k;
        budget = 0;
      }
      a.walk += dt;
    }
    if (!a.path.length) {
      a.settled = true;
      a.face = a.spot.face;
      a.back = !!a.spot.back;
    }
  }
}

// ---- drawing -------------------------------------------------------------------------------

const WARM = rgb(0xf3ddb0), SAGE = rgb(0xc9e6bd), AMBER = rgb(0xf0b45e), DIM = rgb(0x8a8170), BRIGHT = rgb(0xfff1cf);
const RING = rgb(0xece5d6);

export interface DrawOpts { now: number; t: number; selected: string | null; hovered: string | null; animate: boolean }

export function screenOf(a: Actor) {
  return { X: Math.round(sx(a.x, a.y)), Y: Math.round(sy(a.x, a.y, a.z)) };
}

export function lightColor(a: Pick<Actor, "flashAt">, s: AgentState | undefined, now: number) {
  if (now - a.flashAt < 2600) return mix(SAGE, WARM, (now - a.flashAt) / 2600);
  if (s?.pending) return AMBER;
  if (s?.paused || s?.offline) return DIM;
  if (s?.working) return mix(WARM, BRIGHT, 0.5 + 0.5 * Math.sin(now / 500));
  return WARM;
}

export function drawResidents(f: Target, r: Residents, states: Map<string, AgentState>, o: DrawOpts) {
  for (const a of r.actors.values()) {
    if (a.hidden) continue;
    const s = states.get(a.id);
    const { X, Y } = screenOf(a);
    const d = a.x + a.y + 0.35;
    if (a.id === o.selected || a.id === o.hovered) {
      for (let k = 0; k < 20; k++) {
        const th = (k / 20) * Math.PI * 2;
        if (k % 2 && a.id !== o.selected) continue;
        put(f, X + Math.round(Math.cos(th) * 6), Y + Math.round(Math.sin(th) * 2.6), RING, d - 0.6, true);
      }
    }
    footShadow(f, X, Y + 1, d);
    const walking = !a.settled;
    const pose: Pose = walking ? (Math.floor(a.walk / 0.22) % 2 ? "a" : "b") : a.spot.pose === "sit" ? "sit" : "stand";
    const bob = o.animate && !walking && pose === "stand" && Math.floor(o.t * 0.9 + hash(a.id.length, 1, 82) * 4) % 4 === 0 ? 1 : 0;
    const lift = walking && pose === "b" ? 1 : 0;
    const m = drawFigure(f, a.id, pose, a.back, a.face < 0, X, Y - bob - lift, d, lightColor(a, s, o.now));
    a.gy = m.glowY;
    if (s?.pending) {
      const hy = m.top - 4 + (o.animate ? Math.round(Math.sin(o.t * 2) * 0.8) : 0);
      for (const [dx, dy] of [[0, -1], [-1, 0], [0, 0], [1, 0], [0, 1]]) put(f, X + dx, hy + dy, AMBER, d + 0.01, true);
    }
  }
}

/** Re-lights lantern heads after the ambient pass, with a soft halo after dusk. */
export function drawResidentGlow(f: Target, r: Residents, states: Map<string, AgentState>, now: number, dark: number) {
  for (const a of r.actors.values()) {
    if (a.hidden) continue;
    const s = states.get(a.id);
    const { X } = screenOf(a);
    const gy = a.gy;
    const c = lightColor(a, s, now);
    const flash = now - a.flashAt < 2600 ? 1 - (now - a.flashAt) / 2600 : 0;
    put(f, X, gy, c, a.x + a.y + 0.35, true);
    const halo = Math.max(dark * 0.35, flash * 0.6);
    if (halo > 0.02)
      for (let dy = -3; dy <= 3; dy++)
        for (let dx = -3; dx <= 3; dx++) {
          const q = Math.hypot(dx, dy);
          if (q < 1 || q > 3.2) continue;
          blend(f, X + dx, gy + dy, c, halo * (1 - q / 3.4));
        }
  }
}

/** The front-most visible figure under a logical-pixel point. */
export function hitTest(r: Residents, x: number, y: number) {
  let best: Actor | null = null;
  for (const a of r.actors.values()) {
    if (a.hidden) continue;
    const { X, Y } = screenOf(a);
    const h = a.settled && a.spot.pose === "sit" ? 13 : 17;
    if (x >= X - 5 && x <= X + 5 && y >= Y - h - 3 && y <= Y + 2 && (!best || a.x + a.y > best.x + best.y)) best = a;
  }
  return best;
}
