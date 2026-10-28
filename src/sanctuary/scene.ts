// The Sanctuary's static world: terrain, architecture and the walkable graph.
// Drawn once into a buffer; animated parts live in life.ts and actors.ts.
import {
  bayer, box, depthLeft, depthRight, ellipse, GROUND, H, hash, line, makeTarget, mix, noise, ORIGIN,
  groundShadow, poly, put, ramp, raster, rect, rgb, shadow, sx, sy, W, type Target,
} from "./engine.ts";

export const N = 24;

export { PAL } from "./palette.ts";
import { PAL } from "./palette.ts";
import { eaveShade, plinth, railing, roof, steps, warm } from "./architecture.ts";

const GOLD_LEAF = rgb(0xc2a15e);

// ---- terrain map ---------------------------------------------------------------------------

export type Tile = "g" | "m" | "p" | "r" | "w" | "o" | "s" | "b";
export const tiles: Tile[] = new Array(N * N).fill("g");
const at = (x: number, y: number): Tile => (x < 0 || y < 0 || x >= N || y >= N ? "g" : tiles[y * N + x]);
const set = (x: number, y: number, v: Tile) => {
  if (x >= 0 && y >= 0 && x < N && y < N) tiles[y * N + x] = v;
};
const fill = (x0: number, y0: number, x1: number, y1: number, v: Tile) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) set(x, y, v);
};
const blob = (cx: number, cy: number, rx: number, ry: number, v: Tile) => {
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) set(x, y, v);
    }
};
const path = (pts: [number, number][]) => {
  for (let i = 0; i < pts.length - 1; i++) {
    let [x, y] = pts[i];
    const [x1, y1] = pts[i + 1];
    set(x, y, "p");
    while (x !== x1 || y !== y1) {
      if (x !== x1) x += Math.sign(x1 - x);
      else y += Math.sign(y1 - y);
      set(x, y, "p");
    }
  }
};

fill(0, 0, 7, 2, "m");
fill(0, 0, 2, 20, "m");
blob(22, 5, 3.2, 6.5, "b");
fill(20, 0, 24, 3, "b");
fill(13, 0, 22, 6, "s");
fill(15, 13, 23, 21, "s");
fill(1, 18, 10, 24, "r");
fill(10, 9, 15, 13, "s");
blob(9.6, 15.6, 3.7, 2.9, "w");
blob(19, 15.4, 2.3, 1.5, "o");
blob(19.6, 18.4, 1.6, 1.0, "o");
path([[4, 1], [4, 17]]);
path([[5, 5], [6, 5], [6, 6], [9, 6], [9, 9]]);
path([[17, 6], [17, 8], [14, 8], [14, 9]]);
path([[17, 8], [20, 8], [20, 10], [21, 10]]);
path([[4, 17], [5, 17], [5, 18]]);
path([[14, 13], [14, 15]]);
path([[6, 18], [7, 19], [7, 20], [14, 20], [14, 21], [15, 21]]);
fill(14, 21, 15, 21, "p");

// ---- walkable graph --------------------------------------------------------------------------

export interface Node {
  x: number;
  y: number;
  z: number;
}
export type SpotKind = "room" | "study" | "lounge" | "leisure";
export interface Spot extends Node {
  id: string;
  kind: SpotKind;
  /** Spot id, translated for display (see `spots` in the dictionaries). */
  place: string;
  pose: "sit" | "stand";
  /** Facing when settled: 1 = toward the lower right, -1 = lower left; back = facing away. */
  face: 1 | -1;
  back?: boolean;
  room?: number;
  link: string;
}

export const nodes: Record<string, Node> = {
  c1: { x: 4.5, y: 1.6, z: 0 }, c3: { x: 4.5, y: 3, z: 0 }, c5: { x: 4.5, y: 5, z: 0 }, c8: { x: 4.5, y: 8, z: 0 },
  c10: { x: 4.5, y: 10, z: 0 }, c13: { x: 4.5, y: 13, z: 0 }, c15: { x: 4.5, y: 15, z: 0 }, c17: { x: 4.7, y: 17.3, z: 0 },
  sp: { x: 6.5, y: 6.5, z: 0 }, se: { x: 9.5, y: 6.4, z: 0 }, ss: { x: 9.5, y: 8.8, z: 0 },
  pw: { x: 10.6, y: 10, z: 0 }, pn: { x: 12.5, y: 9.3, z: 0 }, pe: { x: 14.3, y: 10.8, z: 0 }, ps: { x: 11.6, y: 12.4, z: 0 },
  lp: { x: 17.5, y: 8.4, z: 0 }, ls: { x: 17.5, y: 6.3, z: 0 },
  be: { x: 20.4, y: 8.6, z: 0 }, bi: { x: 21.3, y: 10.4, z: 0 },
  bw: { x: 5.2, y: 15.5, z: 0 }, b1: { x: 6.8, y: 15.5, z: 4.5 }, bm: { x: 9.5, y: 15.5, z: 8 }, b2: { x: 12.2, y: 15.5, z: 4.5 }, bx: { x: 14, y: 15.5, z: 0 },
  ow: { x: 14.6, y: 13.6, z: 0 }, os: { x: 15.6, y: 19.6, z: 0 },
  gw: { x: 5.6, y: 18.2, z: 0 }, ge: { x: 7.4, y: 20.4, z: 0 }, ps2: { x: 10.5, y: 20.4, z: 0 }, fr: { x: 14.6, y: 21, z: 0 },
};

export const spots: Spot[] = [
  ...[3, 5, 8, 10, 13, 15].map((y, i): Spot => ({ id: `room${i}`, x: 3.55, y, z: 3, kind: "room", place: "room", pose: "sit", face: 1, room: i, link: `c${y}` })),
  { id: "st0", x: 8.4, y: 2.95, z: 3, kind: "study", place: "study", pose: "sit", face: 1, link: "se" },
  { id: "st1", x: 10.3, y: 2.95, z: 3, kind: "study", place: "study", pose: "sit", face: -1, link: "se" },
  { id: "st2", x: 8.4, y: 4.5, z: 3, kind: "study", place: "study", pose: "sit", face: -1, back: true, link: "se" },
  { id: "st3", x: 10.3, y: 4.5, z: 3, kind: "study", place: "study", pose: "sit", face: 1, back: true, link: "se" },
  { id: "l0", x: 15.4, y: 4.75, z: 4, kind: "lounge", place: "lounge", pose: "sit", face: 1, link: "ls" },
  { id: "l1", x: 17.6, y: 4.75, z: 4, kind: "lounge", place: "lounge", pose: "sit", face: -1, link: "ls" },
  { id: "l2", x: 19.8, y: 4.75, z: 4, kind: "lounge", place: "lounge", pose: "sit", face: -1, link: "ls" },
  { id: "pond0", x: 10.2, y: 12.7, z: 0, kind: "leisure", place: "pond", pose: "sit", face: -1, link: "ps" },
  { id: "pond1", x: 13.4, y: 17.6, z: 0, kind: "leisure", place: "pond", pose: "stand", face: -1, link: "bx" },
  { id: "bridge", x: 9.5, y: 15.5, z: 8, kind: "leisure", place: "bridge", pose: "stand", face: 1, link: "bm" },
  { id: "spa0", x: 16.9, y: 15, z: 0, kind: "leisure", place: "pools", pose: "sit", face: 1, link: "ow" },
  { id: "spa1", x: 17.7, y: 17.3, z: 0, kind: "leisure", place: "pools", pose: "sit", face: 1, link: "os" },
  { id: "pav0", x: 4.15, y: 20.35, z: 4, kind: "leisure", place: "pavilion", pose: "sit", face: 1, link: "ge" },
  { id: "pav1", x: 5.1, y: 21.05, z: 4, kind: "leisure", place: "pavilion", pose: "sit", face: 1, link: "ge" },
  { id: "bamboo", x: 21.6, y: 11.3, z: 0, kind: "leisure", place: "bamboo", pose: "stand", face: -1, link: "bi" },
  { id: "garden", x: 20.2, y: 21.4, z: 0, kind: "leisure", place: "garden", pose: "stand", face: -1, link: "fr" },
  { id: "plaza", x: 13.2, y: 11.6, z: 0, kind: "leisure", place: "garden", pose: "stand", face: 1, link: "pe" },
];

export const edges: [string, string][] = [
  ["c1", "c3"], ["c3", "c5"], ["c5", "c8"], ["c8", "c10"], ["c10", "c13"], ["c13", "c15"], ["c15", "c17"],
  ["c5", "sp"], ["sp", "se"], ["se", "ss"], ["ss", "pw"], ["pw", "pn"], ["pn", "pe"], ["pe", "ps"], ["ps", "pw"],
  ["pn", "lp"], ["lp", "ls"], ["lp", "be"], ["be", "bi"],
  ["c15", "bw"], ["bw", "b1"], ["b1", "bm"], ["bm", "b2"], ["b2", "bx"], ["bx", "ow"], ["ow", "pe"],
  ["c17", "gw"], ["gw", "ge"], ["ge", "ps2"], ["ps2", "fr"], ["fr", "os"], ["os", "bx"],
];

// ---- static render -----------------------------------------------------------------------------

export interface StaticScene {
  layer: Target;
  /** 1 = pond, 2 = thermal pool. */
  water: Uint8Array;
  /** 1 = paper window that glows after dusk, 2 = flame. */
  glow: Uint8Array;
  lights: { x: number; y: number; r: number; k: number }[];
  maples: { x: number; y: number }[];
  /** Falling water, animated in life.ts: a column of pixels from y0 to y1. */
  falls?: { x: number; y0: number; y1: number }[];
  /** Steam rises from these points (kettles). */
  steam?: { x: number; y: number }[];
}

/** Ground-plane tile coordinates of a screen pixel. */
export const tileOf = (X: number, Y: number) => {
  const a = (X - ORIGIN.x) / 8, b = (Y - ORIGIN.y) / 4;
  return [(a + b) / 2, (b - a) / 2];
};

const diamond = (x: number, y: number) => [
  [sx(x, y), sy(x, y)], [sx(x + 1, y), sy(x + 1, y)], [sx(x + 1, y + 1), sy(x + 1, y + 1)], [sx(x, y + 1), sy(x, y + 1)],
];

function groundShader(tile: Tile, tx: number, ty: number, s: StaticScene) {
  const near = (v: Tile) => at(tx - 1, ty) === v || at(tx + 1, ty) === v || at(tx, ty - 1) === v || at(tx, ty + 1) === v;
  return (X: number, Y: number) => {
    const h = hash(X, Y, 3);
    const [gx, gy] = tileOf(X, Y);
    switch (tile) {
      case "g": {
        const patch = noise(gx * 0.9, gy * 0.9, 1);
        if (h < 0.012 && patch > 0.55) return PAL.flower[Math.floor(hash(X, Y, 8) * 3)];
        const tuft = hash(X, Y + 1, 7) < 0.05 || h < 0.05;
        const v = 0.5 + (patch - 0.5) * 0.55 + (tuft ? 0.26 : h > 0.95 ? -0.22 : 0);
        return ramp(PAL.grass, near("w") ? v - 0.12 : v, X, Y);
      }
      case "m":
        return ramp(PAL.moss, 0.5 + (noise(gx * 1.3, gy * 1.3, 2) - 0.5) * 0.6 + (h < 0.06 ? 0.3 : 0), X, Y);
      case "b": {
        const litter = h < 0.1 ? ramp(PAL.bamboo, 0.55 + h * 3, X, Y) : 0;
        return litter || ramp(PAL.moss, 0.45 + (noise(gx * 1.5, gy * 1.5, 4) - 0.5) * 0.5, X, Y);
      }
      case "p":
        return ramp(PAL.gravel, 0.25 + h * 0.3 + (noise(gx * 3, gy * 3, 5) - 0.5) * 0.3, X, Y);
      case "r": {
        // Raked gravel: grooves parallel to the x axis, rings around the two garden stones.
        const rocks = [[7.6, 22.4], [1.9, 19.4]];
        let groove = (gy * 3.2) % 1;
        for (const [rx, ry] of rocks) {
          const d = Math.hypot(gx - rx, (gy - ry) * 1.1);
          if (d < 1.7) groove = (d * 3.2) % 1;
        }
        return ramp(PAL.gravel, (groove < 0.34 ? 0.35 : 0.72) + (h - 0.5) * 0.15, X, Y);
      }
      case "s": {
        const fx = gx - Math.floor(gx), fy = gy - Math.floor(gy);
        const grout = fx < 0.07 || fy < 0.07;
        const tone = 0.35 + hash(Math.floor(gx), Math.floor(gy), 9) * 0.4;
        // Moss creeps into the joints, more where the paving is shaded and old.
        if (grout) return noise(gx * 1.7, gy * 1.7, 10) > 0.48 && h < 0.7 ? PAL.moss[2 + (h < 0.2 ? 1 : 0)] : PAL.slab[0];
        return ramp(PAL.slab, tone + (h - 0.5) * 0.18, X, Y);
      }
      case "w": case "o": {
        const i = Y * W + X;
        s.water[i] = tile === "w" ? 1 : 2;
        const depth = tile === "w" ? noise(gx * 0.8, gy * 0.8, 6) * 0.4 : 0.5;
        return ramp(tile === "w" ? PAL.water : PAL.onsen, tile === "w" ? 0.3 + depth : 0.45 + (h - 0.5) * 0.1, X, Y);
      }
    }
  };
}

function drawGround(s: StaticScene) {
  const t = s.layer;
  for (let k = 0; k < N * 2; k++)
    for (let x = 0; x <= k; x++) {
      const y = k - x;
      if (x >= N || y >= N) continue;
      poly(t, diamond(x, y), groundShader(at(x, y), x, y, s), GROUND);
    }
  // Banks: water sits a little lower than the ground, so the far shore shows an earth edge.
  const wet = s.water.slice();
  for (let Y = 2; Y < H; Y++)
    for (let X = 1; X < W - 1; X++) {
      const i = Y * W + X;
      if (!wet[i]) continue;
      const up1 = !wet[i - W], up2 = !wet[i - 2 * W];
      if (up1 || up2) {
        s.water[i] = 0;
        t.c[i] = up1 ? PAL.earth[2] : PAL.earth[1];
      } else if (!wet[i - 1] || !wet[i + 1]) {
        t.c[i] = mix(t.c[i], PAL.earth[3], 0.5);
      }
    }
  // Stepping stones on paths.
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      if (at(x, y) !== "p") continue;
      const jx = (hash(x, y, 11) - 0.5) * 0.25, jy = (hash(x, y, 12) - 0.5) * 0.25;
      const cx = sx(x + 0.5 + jx, y + 0.5 + jy), cy = sy(x + 0.5 + jx, y + 0.5 + jy);
      const rx = 4.2 + hash(x, y, 13) * 1.6, ry = rx * 0.5;
      ellipse(t, cx, cy + 0.5, rx + 1.6, ry + 1, (X, Y) => (hash(X, Y, 15) < 0.22 ? PAL.moss[2 + (hash(X, Y, 16) < 0.3 ? 1 : 0)] : t.c[Y * W + X]), GROUND);
      ellipse(t, cx, cy + 1, rx, ry, PAL.stone[0], GROUND);
      ellipse(t, cx, cy, rx, ry, (X, Y) => ramp(PAL.stone, 0.62 - (Y - cy) / ry * 0.2 - (X - cx) / rx * 0.08 + (hash(X, Y, 14) - 0.5) * 0.12, X, Y), GROUND);
    }
}

function drawCliff(t: Target) {
  // Front-left face (plane y = N) and front-right face (plane x = N), with a ragged underside.
  const faces: [number, number, (X: number) => number, number][] = [
    [sx(0, N), sx(N, N), (X) => depthLeft(X, N), 0],
    [sx(N, N), sx(N, 0), (X) => depthRight(X, N), 1],
  ];
  for (const [xa, xb, dep, side] of faces)
    for (let X = Math.min(xa, xb); X < Math.max(xa, xb); X++) {
      const top = side === 0 ? sy(0, N) + (X - sx(0, N)) / 2 : sy(N, N) - (X - sx(N, N)) / 2;
      const hgt = 22 + Math.round(noise(X * 0.09, side * 7, 21) * 18 + noise(X * 0.4, 3, 22) * 5);
      for (let j = 0; j < hgt; j++) {
        const Y = Math.floor(top) + j;
        const strata = Math.sin((Y - j * 0.2) * 0.75 + noise(X * 0.15, Y * 0.15, 23) * 4) * 0.12;
        const stone = noise(X * 0.35, Y * 0.5, 24) > 0.72 ? 0.22 : 0;
        let v = 0.62 - (j / hgt) * 0.45 + strata + stone - side * 0.14;
        if (j < 2) v = 0.18;
        const c = j === 0 ? PAL.moss[2] : ramp(PAL.earth, v, X, Y);
        // Fade the underside into the void with a dithered edge.
        if (j > hgt - 6 && bayer(X, Y) < (j - (hgt - 6)) / 6) continue;
        put(t, X, Y, c, dep(X));
      }
      // Moss hanging over the lip.
      const drip = hash(X, side, 25);
      if (drip < 0.3) for (let j = 1; j < 2 + Math.floor(drip * 10); j++) put(t, X, Math.floor(top) + j, PAL.moss[1 + (j & 1)], dep(X));
    }
}

// ---- props -----------------------------------------------------------------------------------

const P = (x: number, y: number, z = 0): [number, number] => [sx(x, y), sy(x, y, z)];

/** A stone lantern (tōrō). Returns its light position. */
export function lantern(s: StaticScene, x: number, y: number) {
  const t = s.layer, [X, Y] = P(x, y), d = x + y;
  shadow(t, X + 3, Y + 1, 5, 2);
  const st = (v: number) => (px: number, py: number) => ramp(PAL.stone, v + (hash(px, py, 31) - 0.5) * 0.1, px, py);
  rect(t, X - 3, Y - 2, 7, 2, st(0.45), d);
  rect(t, X - 1, Y - 8, 3, 6, st(0.6), d);
  rect(t, X - 3, Y - 9, 7, 1, st(0.5), d);
  rect(t, X - 2, Y - 13, 5, 4, st(0.55), d);
  rect(t, X - 1, Y - 12, 3, 2, (px, py) => (s.glow[py * W + px] = 2, PAL.flame), d);
  rect(t, X - 4, Y - 15, 9, 2, st(0.72), d);
  put(t, X - 4, Y - 16, PAL.stone[4], d);
  put(t, X + 4, Y - 16, PAL.stone[3], d);
  rect(t, X - 2, Y - 16, 5, 1, st(0.65), d);
  rect(t, X, Y - 18, 1, 2, PAL.stone[4], d);
  s.lights.push({ x: X, y: Y - 11, r: 26, k: 1 });
}

export function rock(s: StaticScene, x: number, y: number, size: number, mossy = true, z = 0, wet = 0) {
  const t = s.layer, [X, Y] = P(x, y, z), d = x + y, r = size * 2.3;
  if (!z) shadow(t, X + r * 0.6, Y + 1, r * 1.1, r * 0.45);
  ellipse(t, X, Y - r * 0.35, r, r * 0.62, (px, py) => {
    const v = 0.6 - wet - (py - (Y - r * 0.35)) / (r * 0.62) * 0.28 - (px - X) / r * 0.12 + (noise(px * 0.5, py * 0.5, 32) - 0.5) * 0.25;
    if (mossy && py < Y - r * 0.6 && hash(px, py, 33) < 0.45) return PAL.moss[3];
    return ramp(PAL.stone, v, px, py);
  }, d);
}

/** Clean index shading for foliage: light from the upper left, a ragged leafy edge. */
function foliage(t: Target, cx: number, cy: number, rx: number, ry: number, ramp_: number[], d: number, seed: number, base = 3) {
  for (let py = Math.floor(cy - ry); py <= Math.ceil(cy + ry); py++)
    for (let px = Math.floor(cx - rx); px <= Math.ceil(cx + rx); px++) {
      const lx = (px + 0.5 - cx) / rx, ly = (py + 0.5 - cy) / ry, r = lx * lx + ly * ly;
      if (r > 1 || (r > 0.7 && hash(px, py, seed) < 0.45)) continue;
      const light = -ly * 1.1 - lx * 0.45;
      let i = base + Math.round(light * 1.5) + (hash(px, py, seed + 1) < 0.12 ? 1 : 0);
      if (r > 0.8 && light > 0.2) i++;
      put(t, px, py, ramp_[Math.max(0, Math.min(ramp_.length - 1, i))], d);
    }
}

/** Japanese maple: a forked trunk under flattened, layered tiers of leaves. */
function maple(s: StaticScene, x: number, y: number, size = 1) {
  const t = s.layer, [X, Y] = P(x, y), d = x + y + 0.2;
  shadow(t, X + 10 * size, Y + 2, 15 * size, 5.5 * size, 0.64);
  const trunk = Math.round(12 * size);
  for (let j = 0; j < trunk; j++) {
    const bend = Math.round(Math.sin(j * 0.28) * 1.3);
    put(t, X + bend, Y - j, PAL.wood[1], d);
    put(t, X + bend + 1, Y - j, j < 2 ? PAL.wood[1] : PAL.wood[2], d);
  }
  line(t, X, Y - trunk + 3, X - Math.round(7 * size), Y - trunk - 4, PAL.wood[1], d);
  line(t, X + 1, Y - trunk + 2, X + Math.round(7 * size), Y - trunk - 6, PAL.wood[2], d);
  s.maples.push({ x: X, y: Y - 20 * size });
  const tiers = [[0, -28, 8, 4.5], [-8, -24, 7, 4], [8, -25, 7, 4], [-1, -21, 11, 5], [-11, -18, 6, 3.6], [10, -18, 6.5, 3.6], [-4, -15, 7.5, 3.4], [5, -14, 6.5, 3.2]];
  tiers.forEach(([ox, oy, rx, ry], k) => foliage(t, X + ox * size, Y + oy * size, rx * size, ry * size, PAL.maple, d + k * 0.001, 34 + k));
}

/** Cloud-pruned pine (niwaki): a sinuous trunk carrying flat pads of needles. */
function pine(s: StaticScene, x: number, y: number, size = 1) {
  const t = s.layer, [X, Y] = P(x, y), d = x + y + 0.2;
  shadow(t, X + 8 * size, Y + 2, 12 * size, 4 * size, 0.66);
  const h = 30 * size;
  const at = (j: number) => X + Math.round(Math.sin(j * 0.12) * 3 * size);
  for (let j = 0; j < h; j++) {
    put(t, at(j), Y - j, PAL.wood[1], d);
    put(t, at(j) + 1, Y - j, j % 5 === 0 ? PAL.wood[2] : PAL.wood[0], d);
  }
  const pads = [[-8, -13, 8, 2.8], [7, -19, 9, 3.2], [-5, -25, 7, 2.6], [4, -30, 5.5, 2.2], [-10, -20, 4.5, 2]];
  for (const [ox, oy] of pads) {
    const j = Math.round(-oy * size) - 2;
    line(t, at(j), Y - j, X + Math.round(ox * size * 0.8), Y + Math.round(oy * size), PAL.wood[0], d);
  }
  pads.forEach(([ox, oy, rx, ry], k) => {
    const cx = X + ox * size, cy = Y + oy * size, rrx = rx * size, rry = ry * size;
    for (let py = Math.floor(cy - rry); py <= Math.ceil(cy + rry); py++)
      for (let px = Math.floor(cx - rrx); px <= Math.ceil(cx + rrx); px++) {
        const lx = (px + 0.5 - cx) / rrx, ly = (py + 0.5 - cy) / rry, r = lx * lx + ly * ly;
        if (r > 1 || (r > 0.68 && hash(px, py, 35 + k) < 0.4)) continue;
        let i = ly < -0.6 ? 5 : ly < -0.2 ? 4 : ly < 0.3 ? 3 : ly < 0.7 ? 2 : 1;
        if ((px * 2 + py * 5) % 7 === 0) i = Math.min(5, i + 1);
        if (lx > 0.6) i = Math.max(0, i - 1);
        put(t, px, py, PAL.pine[i], d + k * 0.001);
      }
  });
}

const SHRUB = [0x22341d, 0x2c4326, 0x38552f, 0x46673a, 0x567a46, 0x6b8f55].map(rgb);
const BLOOM = { pink: [rgb(0xb8616f), rgb(0xd88a96), rgb(0xefb9bf)], white: [rgb(0xb9b2a2), rgb(0xe4dccb), rgb(0xf6f0e2)] };

/** A clipped azalea mound (karikomi), optionally in flower. */
function shrub(s: StaticScene, x: number, y: number, size = 1, bloom?: keyof typeof BLOOM) {
  const t = s.layer, [X, Y] = P(x, y), d = x + y + 0.1;
  const rx = 6 * size, ry = 3.8 * size;
  shadow(t, X + 3, Y + 1, rx + 2, ry * 0.6, 0.62);
  foliage(t, X, Y - ry * 0.8, rx, ry, SHRUB, d, 70);
  if (!bloom) return;
  const c = BLOOM[bloom];
  for (let py = Math.floor(Y - ry * 1.8); py <= Y; py++)
    for (let px = Math.floor(X - rx); px <= X + rx; px++) {
      const lx = (px + 0.5 - X) / rx, ly = (py + 0.5 - (Y - ry * 0.8)) / ry;
      if (lx * lx + ly * ly > 0.8 || hash(px, py, 72) > 0.2) continue;
      put(t, px, py, c[ly < -0.3 ? 2 : ly < 0.3 ? 1 : 0], d + 0.001);
    }
}

/** A low fern: fronds fanning up and out from the root. */
function fern(s: StaticScene, x: number, y: number) {
  const t = s.layer, [X, Y] = P(x, y), d = x + y;
  for (let k = 0; k < 7; k++) {
    const a = Math.PI * (1.08 + (k / 6) * 0.84), len = 4 + hash(k, x * 10, 73) * 3;
    for (let j = 1; j <= len; j++) {
      const px = Math.round(X + Math.cos(a) * j * 1.3), py = Math.round(Y + Math.sin(a) * j * 0.8 + (j * j) / 9);
      put(t, px, py, j > len - 2 ? PAL.grass[5] : PAL.moss[3 + (j & 1)], d);
    }
  }
}

/** Four-eyed bamboo fence (yotsume-gaki): posts, three rails, thin slats, black ties. */
function fence(s: StaticScene, axis: "x" | "y", plane: number, a0: number, a1: number, h = 9) {
  const t = s.layer;
  const at = (a: number, z: number) => (axis === "y" ? P(a, plane, z) : P(plane, a, z));
  const dep = (a: number) => a + plane;
  for (let a = a0; a <= a1 + 1e-6; a += 0.33) {
    const post = Math.abs(((a - a0) / 0.99) - Math.round((a - a0) / 0.99)) < 0.05;
    const [X, Y] = at(a, 0);
    for (let j = 0; j < (post ? h + 1 : h - 1); j++) {
      put(t, X, Y - j, post ? PAL.bamboo[1] : PAL.bamboo[2 + ((j >> 2) & 1)], dep(a), true);
      if (post) put(t, X + 1, Y - j, PAL.bamboo[0], dep(a), true);
    }
  }
  for (const z of [2, Math.round(h / 2), h - 2]) {
    const [Xa, Ya] = at(a0, z), [Xb, Yb] = at(a1, z);
    const n = Math.max(1, Math.round(Math.abs(Xb - Xa)));
    for (let i = 0; i <= n; i++) {
      const f = i / n, X = Math.round(Xa + (Xb - Xa) * f), Y = Math.round(Ya + (Yb - Ya) * f);
      const post = Math.abs((((a1 - a0) * f) / 0.99) - Math.round(((a1 - a0) * f) / 0.99)) < 0.04;
      put(t, X, Y, post ? rgb(0x15110e) : PAL.bamboo[4], dep(a0 + (a1 - a0) * f) + 0.01, true);
    }
  }
}

/** A small cascade: an outcrop of stacked rocks with water falling from its lip into the pond. */
function waterfall(s: StaticScene) {
  const t = s.layer;
  for (const [x, y, r, m, z] of [[5.6, 12.5, 3.2, true, 0], [7.2, 12.4, 2.6, true, 0], [6.2, 12.2, 2.7, true, 7], [6.9, 12.3, 1.9, true, 12], [5.6, 13.6, 2.2, true, 0], [7.4, 13.35, 1.7, false, 0]] as const)
    rock(s, x, y, r, m, z, 0.22);
  const [X, Ytop] = P(6.62, 12.86, 13), [, Ybot] = P(6.85, 13.5, 0);
  const x = Math.round(X) - 1, y0 = Math.round(Ytop), y1 = Math.round(Ybot);
  for (let y = y0; y <= y1; y++)
    for (const dx of [0, 1, 2]) put(t, x + dx, y, y === y0 || dx === 1 ? PAL.water[6] : PAL.water[5], 20.6);
  for (const dx of [-2, -1, 3, 4]) put(t, x + dx, y1, PAL.water[6], 20.6);
  for (const dx of [-1, 3]) put(t, x + dx, y1 - 1, PAL.water[6], 20.6);
  (s.falls ??= []).push({ x, y0, y1 });
}

export const woodGrain = (v: number, along: "x" | "y" = "x") => (X: number, Y: number) => {
  const [gx, gy] = tileOf(X, Y);
  const plank = Math.floor((along === "x" ? gy : gx) * 5);
  return ramp(PAL.wood, v + (hash(plank, 0, 41) - 0.5) * 0.18 + (hash(X, Y, 42) - 0.5) * 0.08, X, Y);
};

export const roofTiles = (v: number) => (X: number, Y: number) => {
  const row = Math.floor((Y - X * 0.5) / 2);
  const seam = (X + row * 2) % 4 === 0;
  return ramp(PAL.roof, v + (row & 1 ? 0.08 : -0.04) - (seam ? 0.12 : 0) + (hash(X, Y, 43) - 0.5) * 0.05, X, Y);
};

export const ROOF = (l: number, r: number) => ({ left: roofTiles(l), right: roofTiles(r), back: PAL.roof[1], ridge: PAL.roof[5], fascia: PAL.roof[0], eave: PAL.roof[4] });

export const tatami = (X: number, Y: number) => {
  const [gx, gy] = tileOf(X, Y);
  const u = (gx * 2) % 1, v = gy % 1;
  if (u < 0.08 || v < 0.06) return PAL.tatami[0];
  return ramp(PAL.tatami, 0.62 + ((Y & 1) ? 0.05 : -0.05) + (hash(X, Y, 53) - 0.5) * 0.1, X, Y);
};

/** Shoji screen in a vertical face: paper with a lattice; marks pixels that glow after dusk. */
export const shoji = (s: StaticScene, cell = 3) => (X: number, Y: number) => {
  if (X % cell === 0 || Y % (cell + 1) === 0) return PAL.lattice;
  s.glow[Y * W + X] = 1;
  return mix(PAL.paper, PAL.plaster[2], hash(X, Y, 44) * 0.3);
};

/** Position on a wall face: u along the wall from a0 (tiles), h above the wall's base (px). */
const onWallY = (y: number, a0: number, z: number) => (X: number, Y: number) => {
  const x = (X - ORIGIN.x) / 8 + y;
  return { u: x - a0, h: sy(x, y, z) - Y };
};
const onWallX = (x: number, a0: number, z: number) => (X: number, Y: number) => {
  const y = x - (X - ORIGIN.x) / 8;
  return { u: y - a0, h: sy(x, y, z) - Y };
};
const plasterAt = (X: number, Y: number, v = 0.55) => ramp(PAL.plaster, v + (hash(X, Y, 45) - 0.5) * 0.12, X, Y);
const timber = (X: number, Y: number, v = 0.3) => ramp(PAL.wood, v + (hash(X >> 1, Y, 49) - 0.5) * 0.1, X, Y);

/** A small hanging paper lantern; returns nothing, registers its glow and light. */
function chochin(s: StaticScene, X: number, Y: number, d: number, r = 20) {
  const t = s.layer;
  put(t, X, Y - 1, PAL.wood[0], d);
  rect(t, X - 1, Y, 3, 4, (px, py) => (s.glow[py * W + px] = 2, py === Y + 2 ? rgb(0xc9773d) : PAL.flame), d);
  rect(t, X - 1, Y + 4, 3, 1, PAL.wood[0], d);
  s.lights.push({ x: X, y: Y + 2, r, k: 0.9 });
}

function cabin(s: StaticScene, y0: number) {
  const t = s.layer;
  const y1 = y0 + 3.9;
  plinth(t, 1, y0, 3.1, y0 + 4, 0, 3);
  const end = onWallY(y1, 1.1, 3), front = onWallX(3, y0 + 0.1, 3);
  box(t, 1.1, y0 + 0.1, 3, y1, 3, 11, {
    top: PAL.plaster[2],
    // End wall: timber frame, a lattice window, a boarded skirt.
    left: (X, Y) => {
      const { u, h } = end(X, Y);
      if (u < 0.14 || u > 1.76 || h > 9.6 || Math.abs(h - 6) < 0.6) return timber(X, Y, 0.28);
      if (h < 3) return timber(X, Y, 0.42 + ((X >> 1) & 1 ? 0.06 : 0));
      if (u > 0.55 && u < 1.35 && h > 6.6 && h < 9) return (X & 1) ? PAL.lattice : warm(PAL.paper, 0.1);
      return plasterAt(X, Y, 0.58);
    },
    // Front: two rooms, each behind a pair of sliding shoji, posts between.
    right: (X, Y) => {
      const { u, h } = front(X, Y);
      const local = u + 0.1;
      if (h > 10 || h < 1 || local < 0.2 || local > 3.7 || Math.abs(local - 1.95) < 0.12) return timber(X, Y, 0.26);
      const inDoor = (local > 0.4 && local < 1.6) || (local > 2.3 && local < 3.5);
      if (inDoor) {
        if (h < 3) return timber(X, Y, 0.5);
        if (Math.abs(local - 1) < 0.05 || Math.abs(local - 2.9) < 0.05) return PAL.wood[1];
        return shoji(s, 3)(X, Y);
      }
      return plasterAt(X, Y, 0.38);
    },
  });
  eaveShade(t, "y", y1, 1.1, 3, 14, 3);
  eaveShade(t, "x", 3, y0 + 0.1, y1, 14, 3);
  roof(t, 0.6, y0 - 0.35, 3.45, y0 + 4.35, 16, 11, "gable", 3.45 + y0 + 4.35);
  // Veranda (engawa) along the front, with a stepping stone below each door.
  box(t, 3.1, y0 + 0.25, 3.95, y0 + 3.75, 0, 3, { top: woodGrain(0.6, "y"), left: PAL.wood[2], right: PAL.wood[1] }, true);
  for (const k of [0, 1]) {
    const [X, Y] = P(4.35, y0 + 1 + k * 2);
    ellipse(t, X, Y, 4, 2, (px, py) => ramp(PAL.stone, 0.7 - (py - Y) * 0.15, px, py), 4.35 + y0 + 1 + k * 2, true);
    put(t, sx(3, y0 + 0.4 + k * 2), sy(3, y0 + 0.4 + k * 2, 12), rgb(0xb89a5c), 3 + y0 + 0.4 + k * 2);
  }
  chochin(s, sx(3.05, y0 + 1.95), sy(3.05, y0 + 1.95, 13), 3.05 + y0 + 2.1, 16);
}

function study(s: StaticScene) {
  const t = s.layer;
  plinth(t, 6.8, 1.8, 11.7, 5.2, 0, 2);
  box(t, 7, 2, 11.5, 5, 2, 1, { top: tatami, left: PAL.wood[3], right: PAL.wood[2] }, true);
  // Back wall of shelves, seen from inside.
  box(t, 7, 1.8, 11.5, 2.05, 3, 23, {
    top: PAL.wood[3],
    right: PAL.wood[1],
    left: (X, Y) => {
      const base = sy(0, 2.05, 0) + (X - sx(0, 2.05)) / 2 - 3;
      const hgt = base - Y;
      if (hgt > 21) return timber(X, Y, 0.24);
      if (hgt % 5 < 1 || X % 13 === 0) return PAL.wood[1];
      const spine = Math.floor((X + Math.floor(hgt / 5) * 3) / 2);
      return hash(spine, Math.floor(hgt / 5), 47) < 0.8 ? PAL.books[Math.floor(hash(spine, 1, 48) * PAL.books.length)] : PAL.wood[0];
    },
  }, true);
  eaveShade(t, "y", 2.05, 7, 11.5, 26, 4);
  // Side wall with a round window (marumado): the Study's signature.
  const side = onWallX(7.05, 2, 3);
  box(t, 6.8, 2, 7.05, 5, 3, 23, {
    top: PAL.wood[3], left: PAL.wood[2],
    right: (X, Y) => {
      const { u, h } = side(X, Y);
      if (h > 21) return timber(X, Y, 0.24);
      const r = Math.hypot((u - 1.5) * 7.5, (h - 12.5) * 1.05);
      if (r < 6.5) return (X % 3 === 0 || Y % 4 === 0) ? PAL.lattice : (s.glow[Y * W + X] = 1, mix(PAL.paper, PAL.plaster[2], 0.2));
      if (r < 7.6) return PAL.wood[1];
      if (h < 3) return timber(X, Y, 0.4);
      return plasterAt(X, Y, 0.5);
    },
  }, true);
  // Low desks with paper lamps.
  for (const x of [8, 9.9]) {
    box(t, x, 3.25, x + 0.85, 3.85, 3, 3, { top: PAL.wood[3], left: PAL.wood[1], right: PAL.wood[0] }, true);
    const [lx, ly] = P(x + 0.65, 3.4, 6);
    rect(t, lx, ly - 3, 2, 3, (px, py) => (s.glow[py * W + px] = 2, PAL.flame), x + 3.9, true);
    put(t, lx, ly - 4, PAL.wood[0], x + 3.9, true);
    s.lights.push({ x: lx, y: ly - 2, r: 16, k: 0.8 });
    put(t, sx(x + 0.3, 3.5), sy(x + 0.3, 3.5, 6), PAL.paper, x + 4, true);
    put(t, sx(x + 0.3, 3.5) + 1, sy(x + 0.3, 3.5, 6), PAL.plaster[3], x + 4, true);
  }
  // Posts, and a head beam (nageshi) across the open front carrying a name board.
  for (const [x, y] of [[11.25, 2.1], [11.25, 4.75], [9.15, 4.75], [7.05, 4.75]])
    box(t, x, y, x + 0.25, y + 0.25, 3, 25, { top: PAL.wood[2], left: PAL.wood[2], right: PAL.wood[1] }, true);
  box(t, 7.05, 4.78, 11.5, 4.98, 23, 2, { top: PAL.wood[2], left: PAL.wood[1], right: PAL.wood[0] }, true);
  box(t, 11.27, 2.1, 11.47, 4.75, 23, 2, { top: PAL.wood[2], left: PAL.wood[1], right: PAL.wood[0] }, true);
  const [gx, gy] = P(9.2, 4.98, 22);
  rect(t, gx - 5, gy - 1, 11, 5, PAL.wood[0], 14.3, true);
  rect(t, gx - 4, gy, 9, 3, rgb(0x2a1f17), 14.31, true);
  for (const dx of [-2, 0, 2]) put(t, gx + dx, gy + 1, GOLD_LEAF, 14.32, true);
  roof(t, 6.5, 1.5, 12, 5.5, 28, 15, "irimoya", 12 + 5.5);
  steps(t, "y", 5.2, 8.6, 9.7, 3, 2, true);
}

function lounge(s: StaticScene) {
  const t = s.layer;
  plinth(t, 13.6, 0.6, 21.4, 5.4, 0, 2);
  const front = onWallY(4, 14, 2), side = onWallX(21, 1, 2);
  box(t, 14, 1, 21, 4, 2, 19, {
    top: PAL.plaster[2],
    left: (X, Y) => {
      const { u, h } = front(X, Y);
      const fx = u % 1;
      if (h > 17.5 || fx < 0.09) return timber(X, Y, 0.26);
      // The entrance: a dark doorway behind an indigo noren with the house mark.
      if (u > 3.15 && u < 3.85) {
        if (h > 9 && h < 16) return Math.abs(u - 3.5) < 0.06 ? PAL.cushion[0] : (Math.abs(u - 3.5) < 0.16 && Math.abs(h - 13) < 1.5 ? PAL.plaster[3] : PAL.cushion[1]);
        return h > 16 ? timber(X, Y, 0.3) : rgb(0x1a1511);
      }
      if (h < 3) return timber(X, Y, 0.45 + (hash(X >> 1, 0, 49) - 0.5) * 0.15);
      if (h < 4) return PAL.wood[1];
      // Bamboo blinds (sudare) half-lowered over two of the screens.
      if ((u > 1 && u < 2) || (u > 5 && u < 6)) if (h > 11) return Y % 2 ? PAL.bamboo[2] : PAL.bamboo[1];
      return shoji(s, 3)(X, Y);
    },
    right: (X, Y) => {
      const { u, h } = side(X, Y);
      if (h > 17.5 || u % 1.5 < 0.12) return timber(X, Y, 0.22);
      if (h > 8 && h < 14 && u > 1 && u < 2.2) return shoji(s, 3)(X, Y);
      if (h < 3) return timber(X, Y, 0.36);
      return plasterAt(X, Y, 0.3);
    },
  }, true);
  eaveShade(t, "y", 4, 14, 21, 21, 4);
  eaveShade(t, "x", 21, 1, 4, 21, 4);
  // Veranda with a railing either side of the entrance, and posts carrying the eave.
  box(t, 14, 4, 21, 5.2, 2, 2, { top: woodGrain(0.6), left: PAL.wood[2], right: PAL.wood[1] }, true);
  railing(t, "y", 5.15, 14.05, 16.7, 4, 5);
  railing(t, "y", 5.15, 18.9, 20.95, 4, 5);
  for (const x of [14.05, 16.4, 18.7, 20.75])
    box(t, x, 4.95, x + 0.25, 5.2, 4, 20, { top: PAL.wood[2], left: PAL.wood[2], right: PAL.wood[1] }, true);
  roof(t, 13.3, 0.3, 21.7, 5.7, 24, 17, "irimoya", 21.7 + 5.7);
  // A gabled entrance porch in front of the noren, below the main eave.
  for (const x of [17.05, 18.2]) box(t, x, 6.05, x + 0.2, 6.25, 0, 17, { top: PAL.wood[2], left: PAL.wood[2], right: PAL.wood[1] }, true);
  roof(t, 16.85, 5.35, 18.55, 6.55, 17, 7, "gable", 28.5);
  steps(t, "y", 5.2, 17.1, 18.3, 4, 2, true);
  // Hanging lanterns under the eaves.
  for (const x of [15.25, 19.85]) chochin(s, ...P(x, 5.45, 19), 30, 22);
  s.lights.push({ x: sx(17.5, 4), y: sy(17.5, 4, 10), r: 34, k: 0.7 });
}

function pavilion(s: StaticScene) {
  const t = s.layer;
  plinth(t, 2.8, 18.8, 6.2, 22.2, 0, 2);
  box(t, 3, 19, 6, 22, 2, 2, { top: tatami, left: PAL.wood[3], right: PAL.wood[2] }, true);
  box(t, 3.7, 20, 4.5, 20.75, 4, 1, { top: PAL.cushion[1], left: PAL.cushion[0], right: PAL.cushion[0] }, true);
  box(t, 4.6, 20.65, 5.4, 21.4, 4, 1, { top: PAL.cushion[1], left: PAL.cushion[0], right: PAL.cushion[0] }, true);
  for (const [x, y] of [[3.05, 19.05], [5.7, 19.05], [3.05, 21.7], [5.7, 21.7]])
    box(t, x, y, x + 0.25, y + 0.25, 4, 24, { top: PAL.wood[2], left: PAL.wood[2], right: PAL.wood[1] }, true);
  railing(t, "x", 5.95, 19.3, 21.6, 4, 4);
  roof(t, 2.4, 18.4, 6.6, 22.6, 28, 14, "pyramid", 6.6 + 22.6);
  steps(t, "y", 22.2, 3.9, 5.1, 4, 2, true);
  // A bronze bell hanging at the centre.
  const [X, Y] = P(4.5, 20.5, 24);
  put(t, X, Y - 2, PAL.wood[0], 30);
  rect(t, X - 1, Y - 1, 3, 3, rgb(0x7d6a3e), 30);
  put(t, X - 1, Y - 1, rgb(0xa88a4e), 30);
}

function bridge(s: StaticScene) {
  const t = s.layer;
  const x0 = 5.4, x1 = 13.6, y0 = 15.1, y1 = 15.9;
  const zAt = (x: number) => 1 + 7 * Math.sin((Math.PI * (x - x0)) / (x1 - x0));
  const step = 0.125;
  for (let x = x0; x < x1 - 1e-6; x += step) {
    const z = zAt(x + step / 2);
    box(t, x, y0, x + step, y1, z - 2, 2, { top: woodGrain(0.62, "y"), left: PAL.rail[1], right: PAL.rail[0] });
  }
  // Railings: posts every tile with brass caps (giboshi), rails following the arch.
  for (const yy of [y0 + 0.05, y1 - 0.05])
    for (let x = x0; x <= x1 + 1e-6; x += (x1 - x0) / 6) {
      const z = zAt(Math.min(x1 - 0.01, Math.max(x0 + 0.01, x)));
      const [X, Y] = P(x, yy, z);
      rect(t, X, Y - 6, 1, 6, PAL.rail[2], x + yy);
      put(t, X, Y - 7, GOLD_LEAF, x + yy);
    }
  for (const yy of [y0 + 0.05, y1 - 0.05]) {
    let prev: [number, number] | null = null;
    for (let x = x0; x <= x1 + 1e-6; x += 0.25) {
      const p = P(x, yy, zAt(x) + 5);
      if (prev) line(t, prev[0], prev[1], p[0], p[1], yy > 15.5 ? PAL.rail[3] : PAL.rail[1], x + yy);
      prev = p;
    }
  }
  // Its reflection, darkened and broken by the surface.
  for (let x = x0; x <= x1; x += 0.05)
    for (const [yy, dz, c] of [[y1, 0, PAL.rail[1]], [y1 - 0.05, 5, PAL.rail[2]]] as const) {
      const z = zAt(x) + dz;
      const X = Math.round(sx(x, yy)), Y = Math.round(sy(x, yy) + z);
      const i = Y * W + X;
      if (s.water[i] === 1 && (Y & 1)) t.c[i] = mix(t.c[i], c, 0.45);
    }
}

function onsen(s: StaticScene) {
  const t = s.layer;
  // Bamboo fence behind the pools.
  box(t, 15.2, 12.6, 22.8, 12.85, 0, 13, {
    top: PAL.bamboo[3],
    right: PAL.bamboo[1],
    left: (X, Y) => {
      const hgt = sy(0, 12.85) + (X - sx(0, 12.85)) / 2 - Y;
      if (Math.abs(hgt - 9) < 0.6 || Math.abs(hgt - 3) < 0.6) return PAL.wood[1];
      if (hgt > 12.4) return PAL.bamboo[4];
      return X % 2 ? ramp(PAL.bamboo, 0.55 + (hash(X, 0, 51) - 0.5) * 0.3, X, Y) : PAL.bamboo[1];
    },
  });
  // An open shelter over the far end of the upper pool: the pavilion itself.
  for (const [x, y] of [[20.15, 12.95], [22.45, 12.95], [20.15, 15.25], [22.45, 15.25]])
    box(t, x, y, x + 0.22, y + 0.22, 0, 22, { top: PAL.wood[2], left: PAL.wood[2], right: PAL.wood[1] });
  box(t, 20.15, 15.25, 22.67, 15.45, 20, 2, { top: PAL.wood[2], left: PAL.wood[1], right: PAL.wood[0] });
  roof(t, 19.8, 12.7, 23, 15.8, 22, 11, "irimoya", 38.8, { lit: 0.6 });
  chochin(s, ...P(21.3, 15.45, 19), 39, 22);
  // Bamboo water spout into the upper pool.
  const [X, Y] = P(20.9, 14, 9);
  line(t, X, Y, X - 8, Y + 3, PAL.bamboo[3], 36);
  line(t, X, Y + 1, X - 8, Y + 4, PAL.bamboo[1], 36);
  // Wooden bench and a stack of wash buckets.
  box(t, 17.8, 19.9, 19.6, 20.4, 0, 4, { top: woodGrain(0.65, "y"), left: PAL.wood[2], right: PAL.wood[1] });
  for (const [x, y] of [[22.2, 18.2], [22.4, 18.6]]) {
    const [bx, by] = P(x, y);
    ellipse(t, bx, by - 2, 2.5, 1.5, PAL.wood[4], x + y);
    rect(t, bx - 2, by - 2, 5, 2, PAL.wood[3], x + y);
    put(t, bx - 2, by - 1, PAL.wood[1], x + y);
  }
}

function pondDetails(s: StaticScene) {
  const t = s.layer;
  for (const [x, y] of [[8.1, 14.1], [11.4, 14.6], [7.4, 16.8], [10.9, 17.4], [12, 16.6]]) {
    const [X, Y] = P(x, y);
    ellipse(t, X, Y, 2.6, 1.3, (px, py) => {
      s.water[py * W + px] = 0;
      return ramp(PAL.lily, 0.6 - (py - Y) * 0.25, px, py);
    }, GROUND);
    put(t, X + 1, Y, PAL.water[2], GROUND);
    if (hash(x * 10, y * 10, 52) < 0.5) put(t, X - 1, Y - 1, PAL.blossom, GROUND);
  }
}

/** Clickable buildings in the garden. Rooms are one region per cabin; the door half picks the room. */
export const REGION = { study: 1, lounge: 2, spa: 3, cabin: 10 } as const;

/** Runs a draw call with every written pixel tagged as belonging to `region`. */
const tagged = (region: number, fn: () => void) => () => {
  raster.region = region;
  fn();
  raster.region = 0;
};

/** Which room a click on cabin k picked, from the tile row under the cursor. */
export function roomAt(cabin: number, X: number) {
  const y0 = [2, 7, 12][cabin];
  const yf = 3 - (X - ORIGIN.x) / 8;
  return cabin * 2 + (yf - y0 < 2 ? 0 : 1);
}

const MAPLES: [number, number, number][] = [[7, 9.4, 0.95], [15.6, 9.2, 0.9], [21.2, 21.4, 1.05], [12.6, 22.5, 0.85]];
const SHRUBS: [number, number, number, keyof typeof BLOOM | undefined][] = [
  [5.6, 3.4, 0.9, undefined], [5.6, 9.1, 0.8, "pink"], [12.2, 6.3, 0.9, "pink"], [7.1, 6.7, 0.8, undefined],
  [14.2, 6.6, 0.8, "white"], [21.9, 6.4, 0.9, undefined], [8.9, 18.9, 0.85, "white"], [11.9, 19.1, 0.8, undefined],
  [9.6, 21.6, 0.95, "pink"], [2.3, 23, 0.9, undefined], [23, 21.6, 0.9, "pink"], [16.6, 22.9, 0.8, undefined],
];

export function renderStatic(): StaticScene {
  const s: StaticScene = { layer: { ...makeTarget(), r: new Uint8Array(W * H) }, water: new Uint8Array(W * H), glow: new Uint8Array(W * H), lights: [], maples: [] };
  drawGround(s);
  drawCliff(s.layer);
  // The pools' stone deck is part of the Wellness Pavilion.
  const deck = [[15, 12.6], [23, 12.6], [23, 21], [15, 21]].map(([x, y]) => [sx(x, y), sy(x, y)]);
  raster.region = REGION.spa;
  poly(s.layer, deck, (X, Y) => s.layer.c[Y * W + X], (X, Y) => s.layer.d[Y * W + X]);
  raster.region = 0;
  // Cast shadows: each footprint swept toward the lower right, away from the light.
  for (const [x0, y0, x1, y1, L] of [[1, 2, 3.9, 6, 1.6], [1, 7, 3.9, 11, 1.6], [1, 12, 3.9, 16, 1.6], [6.8, 1.8, 11.9, 5.3, 2.4], [13.6, 0.6, 21.6, 5.6, 2.2], [2.8, 18.8, 6.4, 22.4, 2.4], [15.2, 12.6, 22.8, 12.85, 1], [19.8, 12.7, 23, 15.8, 1.6]]) {
    const a = L * 0.35;
    groundShadow(s.layer, [[x0, y0], [x1, y0], [x1 + L, y0 + a], [x1 + L, y1 + a], [x0 + L, y1 + a], [x0, y1]].map(([x, y]) => [sx(x, y), sy(x, y)]), 0.74);
  }
  // Fallen leaves on the ground under each maple.
  for (const [mx, my, size] of MAPLES)
    for (let k = 0; k < 70 * size; k++) {
      const a = hash(k, mx * 10, 74) * Math.PI * 2, r = Math.sqrt(hash(k, my * 10, 75)) * 2.4 * size;
      const X = Math.round(sx(mx + Math.cos(a) * r + 0.6, my + Math.sin(a) * r * 0.8)), Y = Math.round(sy(mx + Math.cos(a) * r + 0.6, my + Math.sin(a) * r * 0.8));
      const i = Y * W + X;
      if (i < 0 || i >= W * H || s.layer.d[i] !== GROUND || s.water[i] || !s.layer.c[i]) continue;
      s.layer.c[i] = PAL.maple[2 + Math.floor(hash(k, 3, 76) * 4)];
      if (hash(k, 4, 77) < 0.2 && !s.water[i + 1]) s.layer.c[i + 1] = PAL.maple[3];
    }
  // Props in back-to-front order (by the depth of their front edge).
  const props: [number, () => void][] = [
    [1.6, () => pine(s, 1.2, 0.4, 0.9)],
    [6, () => pine(s, 5.6, 0.4)],
    [11, () => pine(s, 11.4, 0.2, 0.8)],
    [-1, () => pondDetails(s)],
    [4, tagged(REGION.cabin, () => cabin(s, 2))],
    [9, tagged(REGION.cabin + 1, () => cabin(s, 7))],
    [14, tagged(REGION.cabin + 2, () => cabin(s, 12))],
    [17.5, tagged(REGION.study, () => study(s))],
    [27.4, tagged(REGION.lounge, () => lounge(s))],
    ...MAPLES.map(([x, y, size]): [number, () => void] => [x + y, () => maple(s, x, y, size)]),
    [29, () => pavilion(s)],
    [26, tagged(REGION.spa, () => onsen(s))],
    [29.1, () => bridge(s)],
    [-0.5, () => fence(s, "y", 23.7, 0.4, 9.8)],
    [-0.5, () => fence(s, "x", 23.7, 0.4, 12.3)],
    [19.5, () => waterfall(s)],
    [22, () => pine(s, 1.4, 20.6, 0.85)],
    [24, () => rock(s, 7.6, 22.4, 2.8)],
    [22, () => rock(s, 1.9, 19.4, 2.2)],
  ];
  for (const [x, y, r] of [[17.2, 14.3, 2.6], [21.3, 14.1, 3.4], [21.4, 16.6, 2.4], [17.4, 16.9, 2.2], [18.1, 19.5, 2], [21, 19.3, 2.6], [16.9, 15.9, 1.8]])
    props.push([x + y, tagged(REGION.spa, () => rock(s, x, y, r, false))]);
  for (const [x, y, size, bloom] of SHRUBS) props.push([x + y, () => shrub(s, x, y, size, bloom)]);
  for (const [x, y] of [[6.1, 17.5], [14.4, 18.6], [8.2, 22.9], [2.5, 20.0], [12.3, 12.2], [8.6, 12.1]]) props.push([x + y, () => fern(s, x, y)]);
  // Stones set along the pond's shore, leaving the bridge landings, the cascade and the sitting spots clear.
  for (let k = 0; k < 24; k++) {
    const th = (k / 24) * Math.PI * 2, x = 9.6 + Math.cos(th) * 3.45, y = 15.6 + Math.sin(th) * 2.7;
    if ((Math.abs(y - 15.5) < 0.8 && (x < 7 || x > 12)) || Math.hypot(x - 10.2, y - 12.7) < 1 || Math.hypot(x - 13.4, y - 17.6) < 1 || Math.hypot(x - 6.4, y - 13) < 1.3) continue;
    props.push([x + y, () => rock(s, x, y, 0.85 + hash(k, 2, 78) * 0.5, y < 15)]);
  }
  for (const [x, y, r] of [[12.9, 13.1, 2.6], [13.5, 17.3, 2], [7.4, 18.3, 2.4], [5.8, 16.9, 1.6], [11.2, 18.7, 1.8]])
    props.push([x + y, () => rock(s, x, y, r)]);
  for (const [x, y] of [[12.5, 10.9], [13.2, 5.9], [15.4, 12.4], [7.9, 18.6], [5.4, 12.2], [15.6, 21.8]]) props.push([x + y, () => lantern(s, x, y)]);
  props.sort((a, b) => a[0] - b[0]);
  // Depth-test every prop so overlapping objects resolve per pixel, not by draw order.
  raster.test = true;
  for (const [, draw] of props) draw();
  raster.test = false;
  return s;
}

/** Bamboo stalks, re-drawn each frame so they can sway. */
export const bamboo = (() => {
  const out: { x: number; y: number; h: number; w: number; phase: number }[] = [];
  for (let i = 0; i < 40; i++) {
    const x = 19.4 + hash(i, 1, 61) * 4.4, y = 0.2 + hash(i, 2, 62) * 11.5;
    const tx = Math.floor(x), ty = Math.floor(y);
    if (at(tx, ty) !== "b" || (Math.abs(x - 20.5) < 0.9 && y > 7.5)) continue;
    out.push({ x, y, h: 26 + hash(i, 3, 63) * 22, w: hash(i, 4, 64) < 0.4 ? 2 : 1, phase: hash(i, 5, 65) * 6.28 });
  }
  return out.sort((a, b) => a.x + a.y - (b.x + b.y));
})();

