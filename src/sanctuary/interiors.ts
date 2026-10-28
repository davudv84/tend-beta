// Building interiors, drawn with the same engine, palette and depth rules as the garden.
// Each interior is a cut-away room: floor, two back walls, furniture. Interactive objects are tagged
// regions; a few details (screens, lights, keys, slips) are drawn live from agent state in sanctuary.tsx.
import { identity } from "./actors.ts";
import { box, ellipse, H, hash, line, makeTarget, mix, ORIGIN, poly, put, ramp, raster, rect, rgb, scale, shadow, sx, sy, W, type Shader, type Target } from "./engine.ts";
import { PAL } from "./palette.ts";
import { rock, shoji, woodGrain, type StaticScene } from "./scene.ts";

export type PlaceKind = "study" | "lounge" | "spa" | "room";

export interface Seat { x: number; y: number; z: number; pose: "sit" | "stand"; back: boolean; face: 1 | -1 }
export interface Screen { region: number; x: number; y: number; w: number; h: number; d: number }
type Pt = { x: number; y: number };

export interface Interior extends StaticScene {
  kind: PlaceKind;
  view: { x: number; y: number; w: number; h: number };
  seats: Seat[];
  /** Region id → object. Clicking an object opens its details. */
  /** Selectable objects by region; their names live in the dictionaries under `objects`. */
  objects: Record<number, { id: string }>;
  screens: Screen[];
  /** Room only: where the status lantern's light sits. */
  status?: Pt;
  /** Spa only: where review slips are pinned on the notice board. */
  slips?: Pt[];
  /** Study: the equipment rack's lights, one lit per task in progress. */
  leds?: Pt[];
  /** Room: hooks on the key rack, one key hung per granted permission. */
  hooks?: Pt[];
  /** Room: the connection light by the door. */
  link?: Pt;
}

const P = (x: number, y: number, z = 0): [number, number] => [sx(x, y), sy(x, y, z)];
const GOLD = rgb(0xc2a15e), BRASS = rgb(0x9c8048), INK = rgb(0x1c1814), LIGHT = rgb(0xf3e2b8), HERI = rgb(0x2c2a1d);

/** Shader helpers for the two back walls: u = position along the wall in tiles, h = height above the floor. */
const onLeftWall = (fn: (u: number, h: number, X: number, Y: number) => number): Shader => (X, Y) => {
  const yf = -(X - ORIGIN.x) / 8;
  return fn(yf, sy(0, yf) - Y, X, Y);
};
const onRightWall = (fn: (u: number, h: number, X: number, Y: number) => number): Shader => (X, Y) => {
  const xf = (X - ORIGIN.x) / 8;
  return fn(xf, sy(xf, 0) - Y, X, Y);
};
/** Floor tile coordinates of a screen pixel (floor at z = 0). */
const floorAt = (X: number, Y: number) => {
  const a = (X - ORIGIN.x) / 8, b = (Y - ORIGIN.y) / 4;
  return [(a + b) / 2, (b - a) / 2];
};

// ---- floors --------------------------------------------------------------------------------

/** Patches of daylight thrown on the floor through a shoji, crossed by the lattice's shadow. */
type Spill = [x0: number, y0: number, x1: number, y1: number];
function withSpill(spills: Spill[], c: number, X: number, Y: number) {
  const [x, y] = floorAt(X, Y);
  for (const [x0, y0, x1, y1] of spills)
    if (x >= x0 && x <= x1 && y >= y0 && y <= y1) {
      const bar = ((x - x0) * 3.2) % 1 < 0.1 || ((y - y0) * 3.2) % 1 < 0.1;
      return bar ? c : mix(c, LIGHT, 0.2);
    }
  return c;
}

/** Tatami: pairs of 1 × 2 mats in 2 × 2 blocks that alternate direction, bound with dark cloth on the long edges. */
const tatamiFloor = (spills: Spill[] = []): Shader => (X, Y) => {
  const [x, y] = floorAt(X, Y);
  const bx = Math.floor(x / 2), by = Math.floor(y / 2);
  const alongY = ((bx + by) & 1) === 0;
  const across = alongY ? x : y, along = alongY ? y : x;
  const f = across - Math.floor(across), g = along / 2 - Math.floor(along / 2);
  let c: number;
  if (f < 0.07 || f > 0.94) c = HERI;
  else if (g < 0.02) c = PAL.tatami[1];
  else c = PAL.tatami[((alongY ? X : Y) & 1 ? 3 : 2) + (hash(Math.floor(across), bx * 7 + by, 103) < 0.25 ? -1 : 0)];
  return withSpill(spills, c, X, Y);
};

/** Wide floorboards, staggered, with the odd knot. */
const planksFloor = (spills: Spill[] = []): Shader => (X, Y) => {
  const [x, y] = floorAt(X, Y);
  const row = Math.floor(y * 2.4), fy = y * 2.4 - row;
  const len = 2.5 + hash(row, 0, 120) * 2, u = (x + hash(row, 1, 121) * len) / len, seg = Math.floor(u);
  if (fy < 0.13 || u - seg < 0.025) return withSpill(spills, PAL.wood[1], X, Y);
  const v = 0.52 + (hash(row, seg, 122) - 0.5) * 0.2 + (fy > 0.8 ? -0.06 : 0);
  return withSpill(spills, PAL.wood[Math.round(v * 5)], X, Y);
};

/** Stone flags of varied size, the joints greened with moss near the water. */
const flagsFloor: Shader = (X, Y) => {
  const [x, y] = floorAt(X, Y);
  const gx = x / 1.5, gy = y / 1.5 + (Math.floor(x / 1.5) & 1) * 0.5;
  const fx = gx - Math.floor(gx), fy = gy - Math.floor(gy);
  if (fx < 0.05 || fy < 0.05) return hash(Math.floor(gx), Math.floor(gy), 97) < 0.3 ? PAL.moss[2] : PAL.slab[0];
  return ramp(PAL.slab, 0.42 + hash(Math.floor(gx), Math.floor(gy), 98) * 0.34 + (hash(X, Y, 99) - 0.5) * 0.1, X, Y);
};

const plaster = (X: number, Y: number) => PAL.plaster[2 + (hash(X, Y, 91) < 0.15 ? -1 : hash(X, Y, 92) < 0.08 ? 1 : 0)];
const beam = (h: number, top: number) => h < 3 || h > top - 3;
const skirting = (h: number, X: number, Y: number) => (h < 9 ? (h > 8 ? PAL.wood[1] : ramp(PAL.wood, 0.4, X, Y)) : 0);

function blank(kind: PlaceKind, w: number, d: number, wallH: number): Interior {
  return {
    kind, layer: { ...makeTarget(), r: new Uint8Array(W * H) }, water: new Uint8Array(W * H), glow: new Uint8Array(W * H), lights: [], maples: [],
    view: { x: sx(0, d) - 14, y: ORIGIN.y - wallH - 10, w: (w + d) * 8 + 28, h: (w + d) * 4 + wallH + 22 },
    seats: [], objects: {}, screens: [],
  };
}

/** Floor slab and the two back walls. */
function shell(s: Interior, w: number, d: number, wallH: number, floor: Shader, left: Shader, right: Shader) {
  const t = s.layer;
  box(t, 0, 0, w, d, -5, 5, { top: floor, left: (X, Y) => ramp(PAL.wood, 0.35, X, Y), right: PAL.wood[1] });
  box(t, -0.4, -0.4, 0, d, -5, wallH + 5, { top: PAL.wood[2], left: PAL.wood[1], right: left });
  box(t, 0, -0.4, w, 0, -5, wallH + 5, { top: PAL.wood[2], left: right, right: PAL.wood[1] });
  // Contact shadow where the walls meet the floor.
  const dim = (X: number, Y: number) => { const i = Math.round(Y) * W + Math.round(X); if (t.c[i]) t.c[i] = scale(t.c[i], 0.9); };
  for (let x = 0; x < w; x += 0.0625) for (const k of [0.04, 0.16]) dim(...P(x, k));
  for (let y = 0; y < d; y += 0.0625) for (const k of [0.04, 0.16]) dim(...P(k, y));
}

function object(s: Interior, region: number, id: string, draw: () => void) {
  s.objects[region] = { id };
  raster.region = region;
  draw();
  raster.region = 0;
}

// ---- furniture kit ---------------------------------------------------------------------------

/** Which wall a piece stands against: "right" = the back wall y = 0 (front faces +y); "left" = x = 0. */
type Wall = "left" | "right";
/** A box standing against a wall: `a0..a1` along it, `depth` out from it, `z..z+h` high. Front shader gets (u, h). */
function against(t: Target, wall: Wall, a0: number, a1: number, depth: number, z: number, h: number, front: (u: number, hh: number, X: number, Y: number) => number, side = PAL.wood[1], top: Shader = PAL.wood[3]) {
  if (wall === "right") {
    const f: Shader = (X, Y) => { const x = (X - ORIGIN.x) / 8 + depth; return front(x - a0, sy(x, depth, z) - Y, X, Y); };
    box(t, a0, 0, a1, depth, z, h, { top, left: f, right: side });
  } else {
    const f: Shader = (X, Y) => { const y = depth - (X - ORIGIN.x) / 8; return front(y - a0, sy(depth, y, z) - Y, X, Y); };
    box(t, 0, a0, depth, a1, z, h, { top, left: side, right: f });
  }
}

/** Shelving filled with books of varied height, gaps, a few lying flat and some rolled scrolls. */
function shelves(h: number, rows: number, seed: number, frame = 0.6) {
  return (u: number, hh: number, X: number, Y: number) => {
    if (u < 0.08 || u > frame || hh < 2 || hh > h - 2) return u < 0.08 || u > frame ? PAL.wood[2] : PAL.wood[1];
    const sh = (h - 4) / rows, r = Math.floor((hh - 2) / sh), fh = hh - 2 - r * sh;
    if (fh < 1.2) return PAL.wood[3];
    const i = Math.floor((X + r * 5) / 2), k = hash(i, r, seed);
    const top = sh - 1.6 - Math.floor(hash(i, r, seed + 1) * 3);
    if (k < 0.07) return PAL.wood[0];
    if (k < 0.13) return fh < 2.6 ? (Y & 1 ? PAL.plaster[3] : PAL.plaster[1]) : PAL.wood[0];
    if (k < 0.17) return fh < 2 ? PAL.books[(Y + i) % PAL.books.length] : PAL.wood[0];
    if (fh > top) return PAL.wood[0];
    const c = PAL.books[Math.floor(hash(i, r, seed + 2) * PAL.books.length)];
    return (X + r * 5) % 2 === 0 ? scale(c, 1.18) : fh > top - 1 ? scale(c, 0.8) : c;
  };
}

/** A tansu chest: drawers with dark seams and small brass pulls. */
function drawers(rowsH: number, colW: number) {
  return (u: number, hh: number, X: number, Y: number) => {
    const r = hh / rowsH, c = u / colW, fr = r - Math.floor(r), fc = c - Math.floor(c);
    if (fr < 0.14 || fc < 0.06) return PAL.wood[1];
    if (Math.abs(fc - 0.5) < 0.12 && Math.abs(fr - 0.55) < 0.2) return BRASS;
    return ramp(PAL.wood, 0.55 + (hash(Math.floor(c), Math.floor(r), 130) - 0.5) * 0.12, X, Y);
  };
}

/** Drawer fronts on a free-standing chest whose front is the face y = `y`. */
const chestFace = (x0: number, y: number, z: number, rowsH: number, colW: number): Shader => {
  const f = drawers(rowsH, colW);
  return (X, Y) => {
    const x = (X - ORIGIN.x) / 8 + y;
    return f(x - x0, sy(x, y, z) - Y, X, Y);
  };
};

/** A hanging scroll (kakejiku): cloth mount, paper, rollers, and sparse brushwork. */
function scrollArt(mount: number, seed: number) {
  return (u: number, hh: number, w: number, h: number) => {
    if (hh < 1 || hh > h - 1) return PAL.wood[0];
    if (u < 0.1 || u > w - 0.1 || hh < 4 || hh > h - 6) return mount;
    const cx = Math.abs(u - w / 2) < 0.12 && hh > h * 0.3 && hh < h * 0.75;
    return cx || hash(Math.floor(u * 10), Math.floor(hh / 2), seed) < 0.05 ? INK : PAL.paper;
  };
}
function hangOn(t: Target, wall: Wall, a0: number, w: number, z0: number, h: number, art: (u: number, hh: number, w: number, h: number) => number) {
  const pts = wall === "right" ? [P(a0, 0, z0), P(a0 + w, 0, z0), P(a0 + w, 0, z0 + h), P(a0, 0, z0 + h)] : [P(0, a0, z0), P(0, a0 + w, z0), P(0, a0 + w, z0 + h), P(0, a0, z0 + h)];
  poly(t, pts, (X, Y) => {
    const along = wall === "right" ? (X - ORIGIN.x) / 8 : -(X - ORIGIN.x) / 8;
    const hh = (wall === "right" ? sy(along, 0) : sy(0, along)) - Y - z0;
    return art(along - a0, hh, w, h);
  }, (X) => (wall === "right" ? (X - ORIGIN.x) / 8 : -(X - ORIGIN.x) / 8) + 0.02);
}

/** A potted plant: a glazed pot and a clump of leaves, or a small pine. */
function plant(s: Interior, x: number, y: number, z: number, kind: "fern" | "pine" | "bamboo" = "fern", pot = rgb(0x4d5a63)) {
  const t = s.layer, [X, Y] = P(x, y, z), d = x + y + 0.2;
  if (!z) shadow(t, X + 2, Y + 1, 5, 2, 0.75);
  rect(t, X - 2, Y - 4, 5, 4, (px, py) => (px === X - 2 ? scale(pot, 1.2) : py === Y - 4 ? scale(pot, 1.3) : pot), d);
  if (kind === "pine") {
    for (const [ox, oy, rx] of [[-3, -7, 4], [2, -9, 4], [-1, -12, 3]] as const)
      ellipse(t, X + ox, Y + oy, rx, 1.8, (px, py) => PAL.pine[py < Y + oy ? 4 : 2], d);
    line(t, X, Y - 4, X - 2, Y - 9, PAL.wood[1], d - 0.01);
  } else if (kind === "bamboo") {
    for (const [ox, h] of [[-1, 16], [1, 20], [0, 13]] as const)
      for (let j = 4; j < h; j++) {
        put(t, X + ox, Y - j, j % 5 === 0 ? PAL.bamboo[0] : PAL.bamboo[2], d);
        if (j > h - 6 && j % 2 === 0) put(t, X + ox + (j % 4 ? 1 : -1), Y - j, PAL.bamboo[3], d);
      }
  } else
    for (let k = 0; k < 9; k++) {
      const a = Math.PI * (1.05 + (k / 8) * 0.9), len = 4 + (k % 3);
      for (let j = 1; j <= len; j++) put(t, Math.round(X + Math.cos(a) * j * 1.2), Math.round(Y - 4 + Math.sin(a) * j * 0.9 + (j * j) / 10), j > len - 2 ? PAL.grass[5] : PAL.grass[3], d);
    }
}

/** A paper floor lamp (andon) that lights the room. */
function andon(s: Interior, x: number, y: number) {
  const t = s.layer, [X, Y] = P(x, y), d = x + y + 0.2;
  shadow(t, X + 3, Y + 1, 5, 2, 0.75);
  rect(t, X - 3, Y - 13, 7, 11, (px, py) => (px === X - 3 || px === X + 3 || py === Y - 13 ? PAL.wood[0] : (s.glow[py * W + px] = 2, py % 4 === 0 ? rgb(0xe2bd7c) : PAL.flame)), d);
  rect(t, X - 3, Y - 2, 1, 2, PAL.wood[0], d);
  rect(t, X + 3, Y - 2, 1, 2, PAL.wood[0], d);
  s.lights.push({ x: X, y: Y - 7, r: 36, k: 1 });
}

function lamp(s: Interior, x: number, y: number, z: number) {
  const [X, Y] = P(x, y, z);
  rect(s.layer, X - 1, Y - 5, 3, 5, (px, py) => (s.glow[py * W + px] = 2, py === Y - 3 ? rgb(0xe9c58a) : PAL.flame), x + y + 0.2);
  put(s.layer, X, Y - 6, PAL.wood[0], x + y + 0.2);
  rect(s.layer, X - 1, Y, 3, 1, PAL.wood[0], x + y + 0.2);
  s.lights.push({ x: X, y: Y - 3, r: 22, k: 0.9 });
}

/** A flat floor cushion (zabuton). */
function cushion(s: Interior, x: number, y: number, c = PAL.cushion) {
  box(s.layer, x - 0.38, y - 0.38, x + 0.38, y + 0.38, 0, 1, { top: (X, Y) => ((X + Y) % 7 === 0 ? scale(c[1], 1.12) : c[1]), left: c[0], right: scale(c[0], 0.85) });
}

/** A low table on four short legs. */
function lowTable(s: Interior, x0: number, y0: number, x1: number, y1: number, h = 6, top = 0.42) {
  const t = s.layer;
  shadow(t, sx((x0 + x1) / 2, (y0 + y1) / 2) + 5, sy((x0 + x1) / 2, (y0 + y1) / 2) + 2, (x1 - x0 + y1 - y0) * 4.5, (x1 - x0 + y1 - y0) * 1.6, 0.78);
  for (const [x, y] of [[x0 + 0.1, y1 - 0.25], [x1 - 0.25, y1 - 0.25], [x1 - 0.25, y0 + 0.1]]) box(t, x, y, x + 0.15, y + 0.15, 0, h - 2, { top: PAL.wood[1], left: PAL.wood[1], right: PAL.wood[0] });
  box(t, x0, y0, x1, y1, h - 2, 2, { top: woodGrain(top), left: PAL.wood[2], right: PAL.wood[1] });
}

/** A charcoal brazier with an iron kettle; steam rises from the spout. */
function brazier(s: Interior, x: number, y: number) {
  const t = s.layer;
  box(t, x - 0.45, y - 0.45, x + 0.45, y + 0.45, 0, 5, { top: (X, Y) => ((X + Y) & 1 ? rgb(0xd0603a) : rgb(0x3a2a22)), left: PAL.wood[3], right: PAL.wood[2] });
  const [X, Y] = P(x, y, 5);
  for (let py = Y - 6; py <= Y; py++) for (let px = X - 3; px <= X + 3; px++) {
    const dx = (px + 0.5 - X) / 3.3, dy = (py + 0.5 - (Y - 3)) / 3.2;
    if (dx * dx + dy * dy <= 1) put(t, px, py, dx < -0.3 && dy < 0 ? PAL.roof[4] : dy > 0.5 ? PAL.roof[0] : PAL.roof[2], x + y + 0.5);
  }
  rect(t, X - 1, Y - 8, 3, 2, PAL.roof[3], x + y + 0.5);
  put(t, X + 4, Y - 4, PAL.roof[2], x + y + 0.5);
  put(t, X + 5, Y - 5, PAL.roof[3], x + y + 0.5);
  (s.steam ??= []).push({ x: X + 5, y: Y - 6 });
  s.lights.push({ x: X, y: Y, r: 18, k: 0.55 });
}

function cup(t: Target, x: number, y: number, z: number, glaze = PAL.plaster[3]) {
  const [X, Y] = P(x, y, z);
  rect(t, X - 1, Y - 2, 2, 2, glaze, x + y + 0.6);
  put(t, X - 1, Y - 2, rgb(0x6f8a5a), x + y + 0.61);
}

// ---- the study -----------------------------------------------------------------------------

export function study(): Interior {
  const w = 14, d = 10, WH = 46;
  const s = blank("study", w, d, WH);
  const t = s.layer;
  shell(s, w, d, WH, planksFloor([[0.2, 1.2, 2.4, 4.4], [0.2, 5.8, 2.4, 9]]),
    onLeftWall((u, h, X, Y) => {
      if (beam(h, WH)) return PAL.wood[1];
      const win = (u > 1.4 && u < 4) || (u > 6 && u < 8.6);
      if (win && h > 13 && h < 36) return shoji(s, 4)(X, Y);
      if (Math.abs(u - 5) < 0.12 || Math.abs(u - 9.6) < 0.12) return PAL.wood[1];
      return skirting(h, X, Y) || plaster(X, Y);
    }),
    onRightWall((u, h, X, Y) => (beam(h, WH) ? PAL.wood[1] : skirting(h, X, Y) || plaster(X, Y))),
  );
  raster.test = true;
  // Floor-to-beam bookcases along the back wall, and the task board between them.
  object(s, 6, "shelf", () => {
    against(t, "right", 0.2, 4.5, 0.7, 0, 40, shelves(40, 6, 140, 4.2));
    against(t, "right", 4.7, 9.1, 0.7, 0, 40, shelves(40, 6, 141, 4.3));
  });
  object(s, 5, "board", () => {
    poly(t, [P(9.6, 0, 15), P(13.4, 0, 15), P(13.4, 0, 36), P(9.6, 0, 36)], (X, Y) => {
      const xf = (X - ORIGIN.x) / 8, h = sy(xf, 0) - Y;
      if (xf < 9.72 || xf > 13.28 || h < 16 || h > 35) return PAL.wood[1];
      const col = Math.floor((xf - 9.8) / 0.62), row = Math.floor((h - 17) / 4.5);
      const inSlip = (xf - 9.8) % 0.62 > 0.12 && (h - 17) % 4.5 > 1.2;
      if (inSlip && hash(col, row, 95) < 0.7) return (h - 17) % 4.5 > 3.5 && hash(col, row, 96) < 0.5 ? INK : mix(PAL.paper, PAL.plaster[2], hash(col, row, 96) * 0.6);
      return ramp(PAL.cork, 0.5 + (hash(X, Y, 142) - 0.5) * 0.3, X, Y);
    }, (X) => (X - ORIGIN.x) / 8 + 0.01);
  });
  // Equipment rack: a lacquered cabinet whose lights show how many tasks are in progress.
  object(s, 7, "rack", () => {
    against(t, "right", 12.3, 13.7, 0.9, 0, 30, (u, hh) => {
      if (u < 0.1 || u > 1.3 || hh < 2 || hh > 28) return PAL.roof[1];
      return Math.floor(hh / 5) % 2 ? PAL.roof[2] : PAL.roof[3];
    }, PAL.roof[1], PAL.roof[3]);
    s.leds = [];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) {
      const [X, Y] = P(12.7 + c * 0.5, 0.9, 25 - r * 5);
      s.leds.push({ x: X, y: Y });
    }
  });
  // Document cabinet with a reading lamp, against the window wall.
  against(t, "left", 4.6, 5.9, 0.8, 0, 14, drawers(4.5, 0.65));
  lamp(s, 0.4, 5.25, 14);
  for (let k = 0; k < 3; k++) box(t, 0.15, 4.75 + k * 0.12, 0.6, 4.85 + k * 0.12, 14, 1, { top: PAL.paper, left: PAL.plaster[1], right: PAL.plaster[0] });

  const desks: [number, number][] = [[2.2, 3], [7, 3], [2.2, 6.8], [7, 6.8]];
  desks.forEach(([x0, y0], i) => {
    const region = i + 1;
    object(s, region, `desk-${i}`, () => {
      shadow(t, sx(x0 + 1.3, y0 + 0.6) + 6, sy(x0 + 1.3, y0 + 0.6) + 2, 19, 5, 0.78);
      // Legs, a drawer pedestal, and the top.
      box(t, x0 + 0.05, y0 + 0.85, x0 + 0.2, y0 + 1.05, 0, 6, { top: PAL.wood[1], left: PAL.wood[1], right: PAL.wood[0] });
      box(t, x0 + 1.9, y0 + 0.1, x0 + 2.6, y0 + 1.05, 0, 6, { top: PAL.wood[2], left: drawerFace(x0 + 1.9, y0 + 1.05), right: PAL.wood[0] });
      box(t, x0, y0, x0 + 2.7, y0 + 1.15, 6, 1.5, { top: woodGrain(0.46), left: PAL.wood[3], right: PAL.wood[1] });
      // Terminal: lacquered casing, screen facing the seat.
      box(t, x0 + 0.5, y0 + 0.15, x0 + 1.6, y0 + 0.6, 7.5, 10, { top: PAL.roof[3], left: PAL.roof[2], right: PAL.roof[1] });
      const [sx0, sy0] = P(x0 + 0.62, y0 + 0.6, 16);
      s.screens.push({ region, x: sx0, y: sy0 - 1, w: 7, h: 5, d: x0 + y0 + 1.3 });
      rect(t, sx0, sy0 - 1, 7, 6, rgb(0x141a17), x0 + y0 + 1.3);
      lamp(s, x0 + 2.35, y0 + 0.25, 7.5);
      // Papers and a closed book on the desk.
      for (let k = 0; k < 3; k++) put(t, sx(x0 + 1.85 + k * 0.08, y0 + 0.75), sy(x0 + 1.85 + k * 0.08, y0 + 0.75, 7.5) - k, k === 2 ? PAL.paper : PAL.plaster[2], x0 + y0 + 2.7);
      box(t, x0 + 0.15, y0 + 0.7, x0 + 0.5, y0 + 1, 7.5, 1, { top: PAL.books[i % PAL.books.length], left: PAL.plaster[3], right: scale(PAL.books[i % PAL.books.length], 0.7) });
      cushion(s, x0 + 1.95, y0 + 1.75);
    });
    s.seats.push({ x: x0 + 2.0, y: y0 + 1.8, z: 1, pose: "sit", back: true, face: -1 });
  });

  // Corner cabinet with a bonsai, a tall plant by the window.
  box(t, 12.2, 7.6, 13.6, 9.4, 0, 9, { top: woodGrain(0.5), left: chestFace(12.2, 9.4, 0, 3, 0.7), right: PAL.wood[1] });
  plant(s, 12.9, 8.5, 9, "pine", rgb(0x6b4a35));
  plant(s, 0.8, 9.2, 0, "bamboo");
  // Archive boxes stacked by the shelves.
  for (const [x, y, z] of [[4.9, 0.95, 0], [5.4, 0.95, 0], [5.1, 0.95, 4]] as const) box(t, x, y, x + 0.45, y + 0.45, z, 4, { top: PAL.plaster[2], left: rgb(0x8f7a5a), right: rgb(0x75633f) });
  raster.test = false;
  return s;
}

/** Drawer fronts on a desk pedestal facing +y. */
function drawerFace(x0: number, y: number): Shader {
  return (X, Y) => {
    const x = (X - ORIGIN.x) / 8 + y, h = sy(x, y, 0) - Y;
    if (h % 2.5 < 0.6 || x - x0 < 0.06) return PAL.wood[1];
    return Math.abs(x - x0 - 0.35) < 0.08 && h % 2.5 > 1.2 ? BRASS : PAL.wood[3];
  };
}

// ---- the reflection lounge: a library and tea room ---------------------------------------------

export function lounge(ids: string[]): Interior {
  const w = 12, d = 10, WH = 46;
  const s = blank("lounge", w, d, WH);
  const t = s.layer;
  shell(s, w, d, WH, tatamiFloor([[0.2, 0.8, 2.6, 3.2], [0.2, 7.2, 2.6, 9.6], [4.6, 0.2, 7.6, 2.4]]),
    onLeftWall((u, h, X, Y) => {
      if (beam(h, WH)) return PAL.wood[1];
      if (u > 3.4 && u < 6.6) return h < 6 ? PAL.wood[2] : PAL.plaster[3]; // the alcove recess
      if (((u > 0.8 && u < 3) || (u > 7.2 && u < 9.4)) && h > 12 && h < 37) return shoji(s, 4)(X, Y);
      return skirting(h, X, Y) || plaster(X, Y);
    }),
    onRightWall((u, h, X, Y) => {
      if (beam(h, WH)) return PAL.wood[1];
      if (u > 4.6 && u < 7.6 && h > 18 && h < 38) return shoji(s, 4)(X, Y);
      return skirting(h, X, Y) || plaster(X, Y);
    }),
  );
  raster.test = true;
  // Tokonoma: a raised alcove with the scroll and a seasonal arrangement.
  object(s, 7, "alcove", () => {
    box(t, 0, 3.5, 1.1, 6.5, 0, 4, { top: woodGrain(0.62, "y"), left: PAL.wood[2], right: PAL.wood[1] });
    hangOn(t, "left", 4.5, 1, 12, 26, scrollArt(rgb(0x50604f), 97));
    const [vx, vy] = P(0.55, 4.2, 4);
    rect(t, vx - 1, vy - 4, 3, 4, PAL.roof[1], 9);
    put(t, vx - 1, vy - 4, PAL.roof[3], 9);
    for (const [dx, dy, c] of [[0, -6, PAL.wood[2]], [-1, -8, PAL.maple[3]], [1, -9, PAL.maple[4]], [0, -10, PAL.maple[5]], [2, -7, PAL.lily[2]], [-2, -9, PAL.maple[4]], [1, -11, PAL.maple[6]]] as const) put(t, vx + dx, vy + dy, c, 9);
    box(t, 0.2, 5.6, 0.7, 6.1, 4, 2, { top: PAL.stone[4], left: PAL.stone[2], right: PAL.stone[1] });
  });
  // The library: two tall bookcases either side of a window, and a chest between them holding the journals.
  object(s, 31, "library", () => {
    against(t, "right", 0.5, 4.3, 0.7, 0, 40, shelves(40, 6, 150, 3.7));
    against(t, "right", 7.9, 11.6, 0.7, 0, 40, shelves(40, 6, 151, 3.6));
  });
  object(s, 30, "shelf", () => {
    against(t, "right", 4.5, 7.7, 0.8, 0, 10, drawers(3.4, 0.8), PAL.wood[1], woodGrain(0.58));
  });
  ids.slice(0, 7).forEach((id, k) => {
    const x = 4.75 + k * 0.42;
    object(s, 10 + k, `journal-${id}`, () => {
      const c = rgb(identity(id).robe), tall = 6 + (k % 3);
      box(t, x, 0.18, x + 0.3, 0.62, 10, tall, { top: PAL.plaster[3], left: c, right: scale(c, 0.7) });
      const [X, Y] = P(x + 0.15, 0.62, 10 + tall - 2);
      put(t, X, Y, rgb(identity(id).trim), x + 0.8);
      put(t, X, Y + 2, rgb(identity(id).trim), x + 0.8);
    });
  });
  // The tea table at the centre, cushions, cups, a brazier and kettle.
  object(s, 8, "table", () => {
    lowTable(s, 5, 4.3, 7.6, 6.3, 6, 0.38);
    for (const [x, y] of [[6.9, 5.5], [5.6, 5.8], [7.1, 4.8], [5.8, 4.7]]) cup(t, x, y, 6);
    const [tx, ty] = P(6.3, 5.3, 6);
    rect(t, tx - 2, ty - 2, 4, 2, rgb(0x2d3b33), 13.5);
    put(t, tx - 2, ty - 2, rgb(0x4b6656), 13.6);
  });
  for (const [x, y] of [[4.3, 5.3], [8.3, 5.3], [6.3, 3.5], [6.3, 7.1]]) cushion(s, x, y);
  brazier(s, 3.6, 7.4);
  // A reading corner: a writing desk with brush, ink stone and an open book.
  lowTable(s, 9, 3.4, 10.6, 4.4, 5, 0.5);
  box(t, 9.3, 3.6, 9.9, 4.1, 5, 1, { top: (X) => (X & 1 ? PAL.paper : PAL.plaster[3]), left: PAL.plaster[1], right: PAL.plaster[0] });
  box(t, 10.05, 3.6, 10.35, 3.85, 5, 1, { top: INK, left: INK, right: INK });
  cushion(s, 9.8, 5.1, [rgb(0x4a3a2e), rgb(0x5e4a3a)]);
  // Plants, a cabinet with tea things, the floor lamp.
  plant(s, 11.3, 8.9, 0, "pine", rgb(0x5d4a3a));
  plant(s, 0.7, 9.3, 0, "fern", rgb(0x7a6a52));
  against(t, "left", 7.4, 9.2, 0.7, 0, 12, drawers(4, 0.6));
  for (const [y, c] of [[7.7, rgb(0x5f7a8a)], [8.15, PAL.plaster[3]], [8.6, rgb(0x8a5a3e)]] as const) {
    const [X, Y] = P(0.35, y, 12);
    rect(t, X - 1, Y - 3, 3, 3, c, 0.35 + y + 0.6);
  }
  andon(s, 10.6, 8.4);
  // Small things left about: an incense burner, a stack of books by the desk, a folded cloth by the kettle.
  box(t, 2.2, 9, 2.7, 9.5, 0, 3, { top: PAL.wood[3], left: PAL.wood[2], right: PAL.wood[1] });
  rect(t, ...P(2.45, 9.25, 3).map((v, i) => v - [1, 2][i]) as [number, number], 3, 2, rgb(0x7d6a3e), 11.8);
  (s.steam ??= []).push({ x: sx(2.45, 9.25), y: sy(2.45, 9.25, 3) - 3 });
  for (let k = 0; k < 3; k++) box(t, 10.9, 4.5, 11.4 - k * 0.05, 4.9, k, 1, { top: PAL.books[(k * 3) % PAL.books.length], left: PAL.plaster[3], right: scale(PAL.books[(k * 3) % PAL.books.length], 0.7) });
  box(t, 4.2, 7.8, 4.7, 8.1, 0, 1, { top: rgb(0x6d5a74), left: rgb(0x564660), right: rgb(0x4a3c52) });
  s.seats.push(
    { x: 4.3, y: 5.3, z: 1, pose: "sit", back: false, face: 1 },
    { x: 6.3, y: 3.5, z: 1, pose: "sit", back: false, face: -1 },
    { x: 8.3, y: 5.3, z: 1, pose: "sit", back: false, face: -1 },
    { x: 6.3, y: 7.1, z: 1, pose: "sit", back: true, face: -1 },
    { x: 9.8, y: 5.1, z: 1, pose: "sit", back: true, face: 1 },
  );
  raster.test = false;
  return s;
}

// ---- the wellness pavilion (an indoor onsen) --------------------------------------------------

export function spa(): Interior {
  const w = 14, d = 11, WH = 40;
  const s = blank("spa", w, d, WH);
  const t = s.layer;
  shell(s, w, d, WH, flagsFloor,
    onLeftWall((u, h, X) => {
      if (beam(h, WH)) return PAL.wood[1];
      if (Math.floor(u * 8 + 0.5) % 3 === 0 || h % 12 === 0) return PAL.bamboo[0];
      return mix(ramp(PAL.bamboo, 0.3 + (hash(Math.floor(u * 8), 0, 100) - 0.5) * 0.25, X, h), PAL.wood[2], 0.35);
    }),
    onRightWall((u, h, X, Y) => {
      if (beam(h, WH)) return PAL.wood[1];
      // A wide opening onto the garden: maple leaves against a pale sky.
      if (u > 6.2 && u < 11.4 && h > 12 && h < 34) {
        if (Math.abs(u - 8.8) < 0.08 || h < 13 || h > 33) return PAL.wood[1];
        const leaf = hash(Math.floor(u * 6), Math.floor(h / 2), 143);
        if (h > 26 && leaf < 0.55) return PAL.maple[3 + Math.floor(leaf * 5)];
        if (h < 17 && leaf < 0.7) return PAL.moss[2 + Math.floor(leaf * 3)];
        return mix(rgb(0xc9d3c8), rgb(0xe7e2d2), (h - 12) / 22);
      }
      return h < 9 ? ramp(PAL.stone, 0.4, X, Y) : ramp(PAL.wood, 0.3 + (Math.floor(u * 5) % 2) * 0.12, X, Y);
    }),
  );
  // The pool: water below a stone rim, deeper towards the middle.
  const pool = [P(3.6, 2.8), P(10.4, 2.8), P(10.4, 8), P(3.6, 8)];
  poly(t, pool, (X, Y) => {
    s.water[Y * W + X] = 2;
    const [x, y] = floorAt(X, Y);
    const edge = Math.min(x - 3.6, 10.4 - x, y - 2.8, 8 - y);
    return ramp(PAL.onsen, 0.62 - Math.min(1.4, edge) * 0.16 + (hash(X, Y, 101) - 0.5) * 0.06, X, Y);
  }, -1e9);
  const wet = s.water.slice();
  for (let Y = 2; Y < H - 2; Y++)
    for (let X = 1; X < W - 1; X++) {
      const i = Y * W + X;
      if (!wet[i]) continue;
      if (!wet[i - W]) { s.water[i] = 0; t.c[i] = PAL.stone[1]; }
      else if (!wet[i - 2 * W]) { s.water[i] = 0; t.c[i] = PAL.stone[0]; }
    }
  raster.test = true;
  for (const [x, y, r] of [[3.4, 3.4, 1.8], [3.2, 6.6, 2.2], [6.2, 2.6, 1.6], [10.6, 3.6, 2], [10.6, 7.4, 1.6], [7.8, 8.3, 1.4], [4.8, 8.2, 1.7], [8.9, 2.6, 1.3], [3.5, 5, 1.2]]) rock(s, x, y, r, hash(x * 10, y * 10, 144) < 0.5);
  for (const [x, y] of [[2.7, 4.3], [10.9, 5.6], [5.9, 8.6]]) plant(s, x, y, 0, "fern", rgb(0x55605a));
  object(s, 20, "board", () => {
    poly(t, [P(1, 0, 13), P(4.6, 0, 13), P(4.6, 0, 33), P(1, 0, 33)], (X, Y) => {
      const xf = (X - ORIGIN.x) / 8, h = sy(xf, 0) - Y;
      return h < 14 || h > 32 || xf < 1.15 || xf > 4.45 ? PAL.wood[0] : ramp(PAL.cork, 0.5 + (hash(X, Y, 102) - 0.5) * 0.3, X, Y);
    }, (X) => (X - ORIGIN.x) / 8 + 0.01);
    const [X, Y] = P(2.8, 0, 34);
    rect(t, X - 4, Y - 3, 9, 3, PAL.wood[0], 2.9);
    rect(t, X - 3, Y - 2, 7, 1, GOLD, 2.91);
  });
  s.slips = [0, 1, 2, 3, 4, 5].map((k) => {
    const [X, Y] = P(1.45 + (k % 3) * 1.05, 0, 29 - Math.floor(k / 3) * 8);
    return { x: X, y: Y };
  });
  object(s, 21, "ledger", () => {
    box(t, 11.6, 9, 13, 10.2, 0, 7, { top: woodGrain(0.5), left: chestFace(11.6, 10.2, 0, 3.5, 0.7), right: PAL.wood[1] });
    const [lx, ly] = P(12.3, 9.6, 7);
    rect(t, lx - 4, ly - 3, 8, 3, PAL.paper, 30);
    for (let k = 0; k < 3; k++) rect(t, lx - 3, ly - 3 + k, 2 + ((k * 3) % 4), 1, PAL.lattice, 30.1);
    put(t, lx, ly - 3, PAL.wood[0], 30.1);
    put(t, lx + 3, ly - 4, INK, 30.2);
  });
  // A slatted cedar deck with a bench, two resting couches, the wash corner, lanterns.
  box(t, 11.2, 1.6, 13.8, 8.4, 0, 2, { top: (X, Y) => (floorAt(X, Y)[1] * 4 % 1 < 0.2 ? PAL.wood[1] : PAL.wood[3]), left: PAL.wood[2], right: PAL.wood[1] });
  box(t, 12, 3, 13.2, 7.4, 2, 4, { top: woodGrain(0.62, "y"), left: PAL.wood[2], right: PAL.wood[1] });
  for (const y of [0.6, 9.6]) {
    box(t, 6.4, y, 8.6, y + 0.8, 0, 3, { top: rgb(0xd8ccb2), left: PAL.wood[2], right: PAL.wood[1] });
    box(t, 6.4, y, 6.8, y + 0.8, 3, 2, { top: rgb(0xe2d8c0), left: PAL.wood[2], right: PAL.wood[1] });
  }
  for (const [x, y] of [[1.2, 9.4], [1.6, 9.9], [2.4, 9.6]]) {
    const [bx, by] = P(x, y);
    ellipse(t, bx, by - 2, 3, 1.6, PAL.wood[4], x + y + 0.2);
    rect(t, bx - 2, by - 2, 5, 2, PAL.wood[3], x + y + 0.2);
    put(t, bx - 2, by - 1, PAL.wood[1], x + y + 0.2);
  }
  box(t, 0.4, 7.4, 1.4, 8.4, 0, 3, { top: woodGrain(0.6), left: PAL.wood[2], right: PAL.wood[1] });
  const [lx, ly] = P(0.8, 0.8);
  rect(t, lx - 2, ly - 12, 5, 12, (px, py) => (py > ly - 9 && py < ly - 5 && px === lx ? (s.glow[py * W + px] = 2, PAL.flame) : ramp(PAL.stone, 0.55, px, py)), 1.7);
  rect(t, lx - 3, ly - 14, 7, 2, PAL.stone[4], 1.7);
  s.lights.push({ x: lx, y: ly - 7, r: 30, k: 0.9 }, { x: sx(7, 5.4), y: sy(7, 5.4), r: 60, k: 0.35 });
  andon(s, 13.2, 9.6);
  raster.test = false;
  s.seats.push(
    { x: 3.1, y: 5.1, z: 2, pose: "sit", back: false, face: 1 },
    { x: 7.2, y: 2.2, z: 2, pose: "sit", back: false, face: -1 },
    { x: 11, y: 5.6, z: 2, pose: "sit", back: false, face: -1 },
    { x: 12.6, y: 4.2, z: 6, pose: "sit", back: false, face: -1 },
    { x: 12.6, y: 6.2, z: 6, pose: "sit", back: false, face: -1 },
  );
  return s;
}

// ---- an agent's room -------------------------------------------------------------------------

/**
 * One agent's room. The layout varies with the agent id, and the colours come from its assigned identity;
 * nothing here is inferred about the agent. Live details (status, keys, connection) are drawn from state.
 */
export function room(id: string): Interior {
  const w = 10, d = 8, WH = 44;
  const s = blank("room", w, d, WH);
  const t = s.layer;
  const me = identity(id);
  const robe = rgb(me.robe), trim = rgb(me.trim);
  const flip = hash(id.length, id.charCodeAt(0) + id.charCodeAt(id.length - 1), 160) < 0.5;
  shell(s, w, d, WH, tatamiFloor(flip ? [[0.2, 4.4, 2.4, 7.4]] : [[0.2, 4.4, 2.4, 7.4], [0.4, 0.2, 3, 1.8]]),
    onLeftWall((u, h, X, Y) => {
      if (beam(h, WH)) return PAL.wood[1];
      if (u > 4.6 && u < 7.2 && h > 13 && h < 35) return shoji(s, 4)(X, Y);
      return skirting(h, X, Y) || plaster(X, Y);
    }),
    onRightWall((u, h, X, Y) => {
      if (beam(h, WH)) return PAL.wood[1];
      if (u > 7.2 && u < 9.2 && h < 36) return h > 20 ? shoji(s, 4)(X, Y) : h < 9 ? PAL.wood[1] : ramp(PAL.wood, 0.5, X, Y); // sliding door
      return skirting(h, X, Y) || plaster(X, Y);
    }),
  );
  raster.test = true;
  object(s, 1, "banner", () => {
    hangOn(t, "left", 1.3, 1.8, 14, 24, (u, hh, ww, hh2) => {
      if (hh > hh2 - 2) return PAL.wood[0];
      if (Math.abs(u - ww / 2) < 0.25 && hh > 8 && hh < 16) return trim;
      return hh < 3 ? scale(robe, 0.75) : (u < 0.08 || u > ww - 0.08) ? scale(robe, 0.85) : robe;
    });
  });
  object(s, 2, "calendar", () => {
    hangOn(t, "right", 3, 2.4, 17, 16, (u, hh) => {
      if (hh > 12) return robe;
      return (Math.floor(u * 3.4) + Math.floor(hh / 3)) % 2 === 0 ? PAL.paper : PAL.plaster[2];
    });
  });
  object(s, 3, "nameplate", () => {
    hangOn(t, "right", 6.3, 0.7, 22, 7, (u, hh) => (hh < 1 || hh > 6 || u < 0.06 ? PAL.wood[0] : (u * 10 + hh) % 3 < 1 ? INK : BRASS));
  });
  const dx = flip ? 4.6 : 1.2;
  object(s, 4, "desk", () => {
    shadow(t, sx(dx + 1.4, 1.6) + 6, sy(dx + 1.4, 1.6) + 2, 16, 5, 0.8);
    box(t, dx, 1.2, dx + 2.6, 2.3, 0, 7, { top: woodGrain(0.42), left: drawerFace(dx + 1.8, 2.3), right: PAL.wood[0] });
    box(t, dx + 0.4, 1.3, dx + 1.5, 1.75, 7, 10, { top: PAL.roof[3], left: PAL.roof[2], right: PAL.roof[1] });
    const [sx0, sy0] = P(dx + 0.52, 1.75, 15.5);
    s.screens.push({ region: 4, x: sx0, y: sy0 - 1, w: 7, h: 5, d: dx + 2.4 });
    rect(t, sx0, sy0 - 1, 7, 6, rgb(0x141a17), dx + 2.4);
  });
  object(s, 5, "tray", () => {
    box(t, dx + 1.8, 1.4, dx + 2.4, 1.95, 7, 2, { top: PAL.paper, left: PAL.wood[3], right: PAL.wood[2] });
    put(t, ...P(dx + 2.1, 1.7, 9.2), INK, dx + 3.8);
  });
  lamp(s, dx + 0.2, 2.0, 7);
  object(s, 6, "lantern", () => {
    const [X, Y] = P(8.6, 6.6);
    shadow(t, X + 3, Y + 1, 5, 2, 0.75);
    rect(t, X - 2, Y - 13, 5, 10, PAL.paper, 15.2);
    rect(t, X - 2, Y - 3, 5, 3, PAL.wood[0], 15.2);
    rect(t, X - 2, Y - 14, 5, 1, PAL.wood[0], 15.2);
    s.status = { x: X, y: Y - 8 };
  });
  object(s, 7, "keys", () => {
    hangOn(t, "left", 0.4, 0.8, 18, 10, (u, hh) => (hh < 1 || hh > 9 ? PAL.wood[0] : u < 0.06 || u > 0.74 ? PAL.wood[1] : PAL.wood[3]));
    s.hooks = [0, 1, 2, 3, 4, 5].map((k) => {
      const [X, Y] = P(0, 0.52 + (k % 3) * 0.22, 26 - Math.floor(k / 3) * 4);
      return { x: Math.round(X), y: Math.round(Y) };
    });
  });
  object(s, 8, "link", () => {
    hangOn(t, "right", 9.35, 0.45, 20, 6, (u, hh) => (hh < 1 || hh > 5 ? PAL.wood[0] : PAL.wood[2]));
    const [X, Y] = P(9.57, 0, 23);
    s.link = { x: Math.round(X), y: Math.round(Y) };
  });
  // Bedding in the agent's colours, a cushion at the desk, a chest, a plant.
  const fx = flip ? 0.5 : 6.2;
  box(t, fx, 4.6, fx + 2.4, 5.6, 0, 4, { top: PAL.plaster[3], left: PAL.plaster[1], right: PAL.plaster[0] });
  box(t, fx, 4.6, fx + 2.4, 5.6, 4, 2, { top: mix(robe, PAL.plaster[3], 0.55), left: mix(robe, PAL.plaster[1], 0.45), right: mix(robe, PAL.plaster[0], 0.45) });
  cushion(s, dx + 1.4, 3.1, [scale(robe, 0.8), robe]);
  against(t, "left", flip ? 6.6 : 2.6, flip ? 7.8 : 3.8, 0.7, 0, 11, drawers(3.7, 0.6));
  plant(s, flip ? 0.7 : 9.2, flip ? 7.2 : 7.3, 0, flip ? "bamboo" : "fern");
  // A low tea table in the foreground with a cup and a closed book.
  const tx = flip ? 6.4 : 2.2;
  lowTable(s, tx, 5.6, tx + 1.4, 6.6, 4, 0.5);
  cup(t, tx + 0.4, 6.0, 4);
  box(t, tx + 0.7, 5.8, tx + 1.15, 6.3, 4, 1, { top: robe, left: PAL.plaster[3], right: scale(robe, 0.7) });
  s.seats.push({ x: dx + 1.4, y: 3.1, z: 1, pose: "sit", back: true, face: flip ? 1 : -1 });
  raster.test = false;
  return s;
}
