// Japanese architecture for the Sanctuary: tiled roofs, stone plinths, steps, railings.
// Roof planes are inverted from screen pixels back to world coordinates, so tile courses and
// columns follow the slope in true perspective instead of being painted flat.
import { box, depthLeft, depthRight, GROUND, hash, mix, ORIGIN, poly, put, ramp, rect, rgb, scale, sx, sy, W, type Shader, type Target } from "./engine.ts";
import { PAL } from "./palette.ts";

type V3 = [number, number, number];
const P = ([x, y, z]: V3): [number, number] => [sx(x, y), sy(x, y, z)];

/** A sloped plane. axis "y": faces +y (lower left), eave along y = eave; axis "x": faces +x (lower right). */
export interface Plane { axis: "x" | "y"; eave: number; z: number; k: number }

/** Screen pixel → position on the plane: `along` the eave and `up` the slope, both in tiles. */
export function onPlane(p: Plane, X: number, Y: number) {
  const a = (X - ORIGIN.x) / 8;
  if (p.axis === "y") {
    const y = (Y - ORIGIN.y - 4 * a + p.z + p.eave * p.k) / (8 + p.k);
    return { along: a + y, up: p.eave - y };
  }
  const x = (Y - ORIGIN.y + 4 * a + p.z + p.eave * p.k) / (8 + p.k);
  return { along: x - a, up: p.eave - x };
}

const ROW = 0.3, COL = 0.375;
const GOLD = rgb(0xc2a15e);

/** Hongawara tiles: rounded columns, each course shadowed by the lip of the one above, round caps at the eave. */
function tiles(p: Plane, tone: number): Shader {
  const base = Math.round(tone * 5);
  const at = (i: number) => PAL.roof[Math.max(0, Math.min(5, i))];
  return (X, Y) => {
    const { along, up } = onPlane(p, X, Y);
    const c = along / COL, col = Math.floor(c), fc = c - col;
    if (up < 0.14) return fc > 0.2 && fc < 0.75 ? at(base + 2) : PAL.roof[0];
    const r = up / ROW, row = Math.floor(r), fr = r - row;
    if (fr > 0.74) return at(base - 2);
    return at(base + (fc < 0.34 ? 1 : fc > 0.67 ? -1 : 0) + (hash(col, row, 401) < 0.05 ? 1 : 0));
  };
}

/** Thick ridge cap from a to b with raised end tiles (onigawara). */
function ridge(t: Target, a: [number, number], b: [number, number], d: number, ends: [boolean, boolean] = [true, true]) {
  const n = Math.max(1, Math.round(Math.abs(b[0] - a[0])));
  for (let i = 0; i <= n; i++) {
    const X = Math.round(a[0] + ((b[0] - a[0]) * i) / n), Y = Math.round(a[1] + ((b[1] - a[1]) * i) / n);
    put(t, X, Y - 2, PAL.roof[5], d);
    put(t, X, Y - 1, PAL.roof[4], d);
    put(t, X, Y, PAL.roof[2], d);
    put(t, X, Y + 1, PAL.roof[0], d);
  }
  ends.forEach((on, k) => {
    if (!on) return;
    const [X, Y] = k ? b : a;
    rect(t, Math.round(X) - 1, Math.round(Y) - 5, 3, 4, PAL.roof[3], d + 0.01);
    rect(t, Math.round(X) - 1, Math.round(Y) - 5, 3, 1, PAL.roof[5], d + 0.01);
    put(t, Math.round(X) + 1, Math.round(Y) - 3, PAL.roof[1], d + 0.01);
  });
}

/** A hip or ridge line where two slopes meet. */
function hipLine(t: Target, a: [number, number], b: [number, number], d: number) {
  const n = Math.max(1, Math.round(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))));
  for (let i = 0; i <= n; i++) {
    const X = Math.round(a[0] + ((b[0] - a[0]) * i) / n), Y = Math.round(a[1] + ((b[1] - a[1]) * i) / n);
    put(t, X, Y - 1, PAL.roof[5], d);
    put(t, X, Y, PAL.roof[3], d);
  }
}

/** Fascia and rafter ends under a visible eave, from a to b (screen). */
function eave(t: Target, a: [number, number], b: [number, number], d: number) {
  const x0 = Math.round(Math.min(a[0], b[0])), x1 = Math.round(Math.max(a[0], b[0]));
  for (let X = x0; X <= x1; X++) {
    const f = x1 === x0 ? 0 : (X - a[0]) / (b[0] - a[0]);
    const Y = Math.round(a[1] + (b[1] - a[1]) * f);
    put(t, X, Y + 1, PAL.roof[0], d);
    put(t, X, Y + 2, X % 3 === 0 ? PAL.wood[3] : PAL.wood[0], d);
  }
}

/** Upturned eave tip at an outer corner; dir -1 flares left, 1 right. */
function flare(t: Target, [X, Y]: [number, number], dir: -1 | 1, d: number) {
  X = Math.round(X);
  Y = Math.round(Y);
  put(t, X + dir, Y, PAL.roof[3], d);
  put(t, X + dir * 2, Y - 1, PAL.roof[4], d);
  put(t, X + dir * 2, Y - 2, PAL.roof[5], d);
  put(t, X + dir, Y + 1, PAL.roof[0], d);
}

/** Wooden gable infill: vertical slats with a tie beam, between dark bargeboards. */
function gableFace(axis: "x" | "y", plane: number, wood = 0.32): Shader {
  return (X, Y) => {
    const a = (X - ORIGIN.x) / 8;
    const u = axis === "x" ? plane - a : a + plane;
    const slat = Math.floor(u * 8) % 2 === 0;
    return ramp(PAL.wood, wood + (slat ? 0.12 : 0) + (hash(X, Y, 402) - 0.5) * 0.06, X, Y);
  };
}

function bargeboard(t: Target, a: [number, number], b: [number, number], d: number) {
  const n = Math.max(1, Math.round(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))));
  for (let i = 0; i <= n; i++) {
    const X = Math.round(a[0] + ((b[0] - a[0]) * i) / n), Y = Math.round(a[1] + ((b[1] - a[1]) * i) / n);
    put(t, X, Y, PAL.wood[4], d);
    put(t, X, Y + 1, PAL.wood[1], d);
  }
}

function hull(pts: [number, number][]) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], up: [number, number][] = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  for (const q of p.reverse()) {
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

export type RoofKind = "hip" | "irimoya" | "gable" | "pyramid";

/**
 * A tiled roof over the rectangle (x0, y0)–(x1, y1) with its eave at height z, rising rh pixels.
 * The ridge runs along the longer side. Light comes from the upper left, so slopes facing the
 * lower left are lit and slopes facing the lower right are in shade.
 */
export function roof(t: Target, x0: number, y0: number, x1: number, y1: number, z: number, rh: number, kind: RoofKind, depth: number, opts: { lit?: number; shade?: number; finial?: boolean } = {}) {
  const lit = opts.lit ?? 0.56, shade = opts.shade ?? 0.3;
  const alongX = x1 - x0 >= y1 - y0;
  const top = z + rh;
  const A: V3 = [x0, y0, z], B: V3 = [x1, y0, z], C: V3 = [x1, y1, z], D: V3 = [x0, y1, z];
  const pts: V3[] = [A, B, C, D];
  const faces: { poly: V3[]; shader: Shader }[] = [];
  const gables: { poly: V3[]; axis: "x" | "y"; plane: number }[] = [];
  let ridgeLine: [V3, V3] | null = null;
  const hips: [V3, V3][] = [];

  if (kind === "pyramid") {
    const inset = Math.min(x1 - x0, y1 - y0) / 2, k = rh / inset;
    const apex: V3 = [(x0 + x1) / 2, (y0 + y1) / 2, top];
    pts.push(apex);
    faces.push({ poly: [D, C, apex], shader: tiles({ axis: "y", eave: y1, z, k }, lit) });
    faces.push({ poly: [B, C, apex], shader: tiles({ axis: "x", eave: x1, z, k }, shade) });
    hips.push([C, apex]);
    ridgeLine = [apex, apex];
  } else if (alongX) {
    const inset = (y1 - y0) / 2, yc = y0 + inset, k = rh / inset, g = inset / 2;
    const long: Plane = { axis: "y", eave: y1, z, k }, end: Plane = { axis: "x", eave: x1, z, k };
    if (kind === "hip") {
      const R0: V3 = [x0 + inset, yc, top], R1: V3 = [x1 - inset, yc, top];
      pts.push(R0, R1);
      faces.push({ poly: [D, C, R1, R0], shader: tiles(long, lit) }, { poly: [B, C, R1], shader: tiles(end, shade) });
      hips.push([C, R1]);
      ridgeLine = [R0, R1];
    } else if (kind === "irimoya") {
      const R0: V3 = [x0 + g, yc, top], R1: V3 = [x1 - g, yc, top];
      const G1: V3 = [x1 - g, yc + g, z + rh / 2], G1b: V3 = [x1 - g, yc - g, z + rh / 2], G0: V3 = [x0 + g, yc + g, z + rh / 2];
      pts.push(R0, R1);
      faces.push({ poly: [D, C, G1, R1, R0, G0], shader: tiles(long, lit) }, { poly: [B, C, G1, G1b], shader: tiles(end, shade) });
      gables.push({ poly: [G1b, G1, R1], axis: "x", plane: x1 - g });
      hips.push([C, G1]);
      ridgeLine = [R0, R1];
    } else {
      const R0: V3 = [x0, yc, top], R1: V3 = [x1, yc, top];
      pts.push(R0, R1);
      faces.push({ poly: [D, C, R1, R0], shader: tiles(long, lit) });
      gables.push({ poly: [B, C, R1], axis: "x", plane: x1 });
      ridgeLine = [R0, R1];
    }
  } else {
    const inset = (x1 - x0) / 2, xc = x0 + inset, k = rh / inset, g = inset / 2;
    const long: Plane = { axis: "x", eave: x1, z, k }, end: Plane = { axis: "y", eave: y1, z, k };
    if (kind === "hip") {
      const R0: V3 = [xc, y0 + inset, top], R1: V3 = [xc, y1 - inset, top];
      pts.push(R0, R1);
      faces.push({ poly: [B, C, R1, R0], shader: tiles(long, shade) }, { poly: [D, C, R1], shader: tiles(end, lit) });
      hips.push([C, R1]);
      ridgeLine = [R0, R1];
    } else if (kind === "irimoya") {
      const R0: V3 = [xc, y0 + g, top], R1: V3 = [xc, y1 - g, top];
      const G1: V3 = [xc + g, y1 - g, z + rh / 2], G1b: V3 = [xc - g, y1 - g, z + rh / 2], G0: V3 = [xc + g, y0 + g, z + rh / 2];
      pts.push(R0, R1);
      faces.push({ poly: [B, C, G1, R1, R0, G0], shader: tiles(long, shade) }, { poly: [D, C, G1, G1b], shader: tiles(end, lit) });
      gables.push({ poly: [G1b, G1, R1], axis: "y", plane: y1 - g });
      hips.push([C, G1]);
      ridgeLine = [R0, R1];
    } else {
      const R0: V3 = [xc, y0, top], R1: V3 = [xc, y1, top];
      pts.push(R0, R1);
      faces.push({ poly: [B, C, R1, R0], shader: tiles(long, shade) });
      gables.push({ poly: [D, C, R1], axis: "y", plane: y1 });
      ridgeLine = [R0, R1];
    }
  }

  // Back slopes only ever show at the silhouette: one dark hull behind the visible faces.
  // (A hair behind the faces: depth is stored as float32, so equal depths can fail the test.)
  poly(t, hull(pts.map(P)), PAL.roof[1], depth - 0.02);
  for (const f of faces) poly(t, f.poly.map(P), f.shader, depth);
  for (const g of gables) {
    poly(t, g.poly.map(P), gableFace(g.axis, g.plane), depth + 0.01);
    const [a, b, c] = g.poly.map(P);
    bargeboard(t, a, c, depth + 0.02);
    bargeboard(t, c, b, depth + 0.02);
    rect(t, Math.round(c[0]) - 1, Math.round(c[1]) + 1, 3, 2, GOLD, depth + 0.03);
  }
  for (const [a, b] of hips) hipLine(t, P(a), P(b), depth + 0.02);
  eave(t, P(D), P(C), depth + 0.02);
  eave(t, P(C), P(B), depth + 0.02);
  flare(t, P(D), -1, depth + 0.02);
  flare(t, P(B), 1, depth + 0.02);
  if (ridgeLine && kind !== "pyramid") {
    const [r0, r1] = ridgeLine.map(P);
    ridge(t, r0, r1, depth + 0.03, [kind !== "gable", true]);
  }
  if (kind === "pyramid" && opts.finial !== false) {
    const [X, Y] = P(ridgeLine![0]).map(Math.round);
    rect(t, X - 1, Y - 1, 3, 2, PAL.roof[4], depth + 0.03);
    rect(t, X - 1, Y - 4, 3, 3, GOLD, depth + 0.03);
    put(t, X - 1, Y - 4, rgb(0xe3cb8a), depth + 0.04);
    put(t, X, Y - 5, GOLD, depth + 0.03);
  }
}

/** A lean-to skirt roof (mokoshi) along a wall: from height z at the wall, out by `out` tiles and down by `drop` px. */
export function skirt(t: Target, axis: "x" | "y", wall: number, a0: number, a1: number, z: number, out: number, drop: number, depth: number, tone: number) {
  const k = drop / out, e = wall + out, ze = z - drop;
  const pts: V3[] = axis === "y"
    ? [[a0, wall, z], [a1, wall, z], [a1, e, ze], [a0, e, ze]]
    : [[wall, a0, z], [wall, a1, z], [e, a1, ze], [e, a0, ze]];
  poly(t, pts.map(P), tiles({ axis, eave: e, z: ze, k }, tone), depth);
  const [, , c, d] = pts.map(P);
  eave(t, d, c, depth + 0.01);
  hipLine(t, P(pts[0]), P(pts[1]), depth + 0.01);
}

/** Cut-stone plinth: courses of blocks with mortar joints. */
export function plinth(t: Target, x0: number, y0: number, x1: number, y1: number, z: number, h: number) {
  const face = (axis: "x" | "y", plane: number, tone: number): Shader => (X, Y) => {
    const a = (X - ORIGIN.x) / 8;
    const base = axis === "y" ? sy(a + plane, plane, z) : sy(plane, plane - a, z);
    const hh = base - Y, row = Math.floor(hh / 3);
    const u = X + row * 4, blk = Math.floor(u / 7);
    if (hh % 3 > 2.2 || u % 7 === 0) return PAL.stone[0];
    return ramp(PAL.stone, tone + (hash(blk, row, 403) - 0.5) * 0.3 + (hh >= h - 1 ? 0.12 : 0), X, Y);
  };
  box(t, x0, y0, x1, y1, z, h, { top: (X, Y) => ramp(PAL.slab, 0.6 + (hash(X, Y, 404) - 0.5) * 0.15, X, Y), left: face("y", y1, 0.58), right: face("x", x1, 0.36) }, true);
}

/** Wooden or stone steps climbing to height h, set against the face at `plane`. */
export function steps(t: Target, axis: "x" | "y", plane: number, a0: number, a1: number, h: number, n = 2, stone = false) {
  const tread = 0.32;
  for (let i = 0; i < n; i++) {
    const zt = (h * (n - i)) / (n + 1);
    const o0 = plane + tread * i, o1 = plane + tread * (i + 1);
    const c = stone
      ? { top: PAL.slab[3 - (i % 2)], left: PAL.stone[2], right: PAL.stone[1] }
      : { top: PAL.wood[4], left: PAL.wood[2], right: PAL.wood[1] };
    if (axis === "y") box(t, a0, o0, a1, o1, 0, zt, c, true);
    else box(t, o0, a0, o1, a1, 0, zt, c, true);
  }
}

/** A low wooden railing along the edge `plane` of a veranda at height z. */
export function railing(t: Target, axis: "x" | "y", plane: number, a0: number, a1: number, z: number, h = 5, posts = 0.75) {
  for (let a = a0; a <= a1 + 1e-6; a += (a1 - a0) / Math.max(1, Math.round((a1 - a0) / posts))) {
    const [X, Y] = axis === "y" ? P([a, plane, z]) : P([plane, a, z]);
    const d = axis === "y" ? a + plane + 0.05 : plane + a + 0.05;
    for (let j = 0; j < h + 1; j++) put(t, X, Y - j, j === h ? PAL.wood[4] : PAL.wood[1], d, true);
  }
  for (const [hh, c] of [[h, PAL.wood[4]], [h - 1, PAL.wood[1]], [Math.round(h / 2), PAL.wood[2]]] as const) {
    const a = axis === "y" ? P([a0, plane, z + hh]) : P([plane, a0, z + hh]);
    const b = axis === "y" ? P([a1, plane, z + hh]) : P([plane, a1, z + hh]);
    const n = Math.max(1, Math.abs(Math.round(b[0] - a[0])));
    for (let i = 0; i <= n; i++) {
      const X = Math.round(a[0] + ((b[0] - a[0]) * i) / n), Y = Math.round(a[1] + ((b[1] - a[1]) * i) / n);
      const d = axis === "y" ? a0 + ((a1 - a0) * i) / n + plane + 0.04 : plane + a0 + ((a1 - a0) * i) / n + 0.04;
      put(t, X, Y, c, d, true);
    }
  }
}

/** Darkens the top of a wall face under an overhanging eave. */
export function eaveShade(t: Target, axis: "x" | "y", plane: number, a0: number, a1: number, zTop: number, px = 3) {
  const xa = axis === "y" ? sx(a0, plane) : sx(plane, a1), xb = axis === "y" ? sx(a1, plane) : sx(plane, a0);
  for (let X = Math.ceil(Math.min(xa, xb)); X < Math.max(xa, xb); X++) {
    const a = (X - ORIGIN.x) / 8;
    const Y0 = Math.round(axis === "y" ? sy(a + plane, plane, zTop) : sy(plane, plane - a, zTop));
    const want = axis === "y" ? depthLeft(X, plane) : depthRight(X, plane);
    for (let j = 0; j < px; j++) {
      const i = (Y0 + j) * W + X;
      if (i < 0 || i >= t.c.length || t.d[i] === GROUND || Math.abs(t.d[i] - want) > 0.05) continue;
      t.c[i] = scale(t.c[i], 0.66 + (j / px) * 0.24);
    }
  }
}

/** Mixes a colour toward warm lamplight. */
export const warm = (c: number, k: number) => mix(c, rgb(0xf3d49a), k);
