// Tiny software rasterizer for the Sanctuary. Everything is drawn into a low-resolution
// buffer with hard pixel edges (no canvas anti-aliasing), plus a depth buffer so agents
// are correctly hidden behind architecture, then scaled up with nearest-neighbour.

export const W = 480;
export const H = 300;

export interface Target {
  w: number;
  h: number;
  c: Uint32Array; // ABGR, ready for ImageData
  d: Float32Array; // depth: tile x + y of the surface; larger is closer to the viewer
  /** Optional: which interactive object owns each pixel (0 = none). */
  r?: Uint8Array;
}

export const GROUND = -1e9;

export function makeTarget(w = W, h = H): Target {
  return { w, h, c: new Uint32Array(w * h), d: new Float32Array(w * h).fill(GROUND) };
}

// ---- colour ---------------------------------------------------------------------------

/** 0xRRGGBB → packed ABGR. */
export const rgb = (hex: number) => (0xff000000 | ((hex & 0xff) << 16) | (hex & 0xff00) | ((hex >> 16) & 0xff)) >>> 0;
const R = (c: number) => c & 255;
const G = (c: number) => (c >>> 8) & 255;
const B = (c: number) => (c >>> 16) & 255;
const pack = (r: number, g: number, b: number) =>
  (0xff000000 | (Math.min(255, b) << 16) | (Math.min(255, g) << 8) | Math.min(255, r)) >>> 0;

export function mix(a: number, b: number, t: number) {
  return pack(
    Math.round(R(a) + (R(b) - R(a)) * t),
    Math.round(G(a) + (G(b) - G(a)) * t),
    Math.round(B(a) + (B(b) - B(a)) * t),
  );
}

export const scale = (c: number, k: number) => pack(Math.round(R(c) * k), Math.round(G(c) * k), Math.round(B(c) * k));

export function tint(c: number, r: number, g: number, b: number) {
  return pack(Math.round(R(c) * r), Math.round(G(c) * g), Math.round(B(c) * b));
}

// ---- noise ----------------------------------------------------------------------------

export function hash(x: number, y: number, s = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** Ordered-dither threshold in [0, 1). */
export const bayer = (x: number, y: number) => BAYER[((y & 3) << 2) | (x & 3)] / 16;

/** Smooth value noise in [0, 1). */
export function noise(x: number, y: number, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Picks from a dark→light ramp using a value in [0, 1] with ordered dithering between steps. */
export function ramp(colors: number[], v: number, x: number, y: number) {
  const f = Math.max(0, Math.min(0.9999, v)) * (colors.length - 1);
  const i = Math.floor(f);
  return colors[Math.min(colors.length - 1, i + (f - i > bayer(x, y) ? 1 : 0))];
}

// ---- isometric projection ---------------------------------------------------------------

/** Screen position of the top corner of tile (0, 0). */
export const ORIGIN = { x: 240, y: 62 };
export const sx = (x: number, y: number) => ORIGIN.x + (x - y) * 8;
export const sy = (x: number, y: number, z = 0) => ORIGIN.y + (x + y) * 4 - z;
/** Depth of a horizontal surface at height z covering screen row Y. */
export const depthTop = (Y: number, z: number) => (Y - ORIGIN.y + z) / 4;
/** Depth on a vertical face lying in the plane y = y1 (faces the lower left). */
export const depthLeft = (X: number, y1: number) => (X - ORIGIN.x) / 8 + 2 * y1;
/** Depth on a vertical face lying in the plane x = x1 (faces the lower right). */
export const depthRight = (X: number, x1: number) => 2 * x1 - (X - ORIGIN.x) / 8;

// ---- raster primitives ------------------------------------------------------------------

export type Shader = number | ((x: number, y: number) => number);
export type Depth = number | ((x: number, y: number) => number);

/** When set, every write is depth-tested, so draw order stops mattering. `region` tags written pixels. */
export const raster = { test: false, region: 0 };

/** Writes a pixel. With `test`, only if it is in front of what is already there. */
export function put(t: Target, x: number, y: number, c: number, d: number, test = false) {
  x |= 0;
  y |= 0;
  if (x < 0 || y < 0 || x >= t.w || y >= t.h) return;
  const i = y * t.w + x;
  if ((test || raster.test) && d < t.d[i]) return;
  t.c[i] = c;
  t.d[i] = d;
  if (t.r) t.r[i] = raster.region;
}

/** Alpha-blends a colour over the pixel without touching depth. */
export function blend(t: Target, x: number, y: number, c: number, a: number, d = GROUND) {
  x |= 0;
  y |= 0;
  if (x < 0 || y < 0 || x >= t.w || y >= t.h || a <= 0) return;
  const i = y * t.w + x;
  if (d !== GROUND && d < t.d[i]) return;
  t.c[i] = mix(t.c[i], c, Math.min(1, a));
}

/** Scanline fill of a convex polygon given in screen pixels. Shared edges never overlap. */
export function poly(t: Target, pts: number[][], shader: Shader, depth: Depth, test = false) {
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  const y0 = Math.max(0, Math.ceil(minY - 0.5));
  const y1 = Math.min(t.h - 1, Math.floor(maxY - 0.5));
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5;
    let xl = Infinity, xr = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % pts.length];
      if ((ay <= cy && by > cy) || (by <= cy && ay > cy)) {
        const x = ax + ((cy - ay) / (by - ay)) * (bx - ax);
        xl = Math.min(xl, x);
        xr = Math.max(xr, x);
      }
    }
    if (xl > xr) continue;
    const a = Math.max(0, Math.ceil(xl - 0.5));
    const b = Math.min(t.w - 1, Math.floor(xr - 0.5));
    for (let x = a; x <= b; x++) {
      put(t, x, y, typeof shader === "number" ? shader : shader(x, y), typeof depth === "number" ? depth : depth(x, y), test);
    }
  }
}

export function rect(t: Target, x: number, y: number, w: number, h: number, shader: Shader, depth: Depth, test = false) {
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const px = x + i, py = y + j;
      put(t, px, py, typeof shader === "number" ? shader : shader(px, py), typeof depth === "number" ? depth : depth(px, py), test);
    }
}

/** Filled pixel ellipse centred on (cx, cy). */
export function ellipse(t: Target, cx: number, cy: number, rx: number, ry: number, shader: Shader, depth: Depth, test = false) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) put(t, x, y, typeof shader === "number" ? shader : shader(x, y), typeof depth === "number" ? depth : depth(x, y), test);
    }
}

// ---- isometric solids -------------------------------------------------------------------

export interface BoxColors {
  top: Shader;
  left: Shader;
  right: Shader;
}

/** Axis-aligned box from (x0, y0) to (x1, y1) in tiles, from height z to z + h in pixels. */
export function box(t: Target, x0: number, y0: number, x1: number, y1: number, z: number, h: number, c: BoxColors, test = false) {
  const top = z + h;
  poly(t, [[sx(x0, y1), sy(x0, y1, top)], [sx(x1, y1), sy(x1, y1, top)], [sx(x1, y1), sy(x1, y1, z)], [sx(x0, y1), sy(x0, y1, z)]], c.left, (X) => depthLeft(X, y1), test);
  poly(t, [[sx(x1, y0), sy(x1, y0, top)], [sx(x1, y1), sy(x1, y1, top)], [sx(x1, y1), sy(x1, y1, z)], [sx(x1, y0), sy(x1, y0, z)]], c.right, (X) => depthRight(X, x1), test);
  poly(t, [[sx(x0, y0), sy(x0, y0, top)], [sx(x1, y0), sy(x1, y0, top)], [sx(x1, y1), sy(x1, y1, top)], [sx(x0, y1), sy(x0, y1, top)]], c.top, (_, Y) => depthTop(Y, top), test);
}

/**
 * Hip roof over a rectangle at eave height z, rising `rh` pixels to a ridge along the longer axis.
 * `colors.left` shades the slope facing the lower left, `colors.right` the one facing the lower right.
 */
export function hipRoof(t: Target, x0: number, y0: number, x1: number, y1: number, z: number, rh: number, colors: { left: Shader; right: Shader; back: Shader; ridge: number; fascia: number; eave: number }, depth: number) {
  const alongX = x1 - x0 >= y1 - y0;
  const inset = (alongX ? y1 - y0 : x1 - x0) / 2;
  const P = (x: number, y: number, h: number) => [sx(x, y), sy(x, y, h)];
  const top = z + rh;
  const r0 = alongX ? P(x0 + inset, (y0 + y1) / 2, top) : P((x0 + x1) / 2, y0 + inset, top);
  const r1 = alongX ? P(x1 - inset, (y0 + y1) / 2, top) : P((x0 + x1) / 2, y1 - inset, top);
  const A = P(x0, y0, z), Bp = P(x1, y0, z), C = P(x1, y1, z), D = P(x0, y1, z);
  // Back slopes first, then the visible front slopes over them.
  if (alongX) {
    poly(t, [A, Bp, r1, r0], colors.back, depth);
    poly(t, [A, r0, D], colors.back, depth);
    poly(t, [D, C, r1, r0], colors.left, depth);
    poly(t, [Bp, C, r1], colors.right, depth);
  } else {
    poly(t, [A, D, r1, r0], colors.back, depth);
    poly(t, [A, Bp, r0], colors.back, depth);
    poly(t, [Bp, C, r1, r0], colors.right, depth);
    poly(t, [D, C, r1], colors.left, depth);
  }
  line(t, r0[0], r0[1], r1[0], r1[1], colors.ridge, depth + 0.01);
  // Dark fascia under the two visible eaves gives the roof a crisp silhouette.
  line(t, D[0], D[1], C[0], C[1], colors.fascia, depth + 0.01);
  line(t, C[0], C[1], Bp[0], Bp[1], colors.fascia, depth + 0.01);
  line(t, D[0], D[1] - 1, C[0], C[1] - 1, colors.eave, depth + 0.01);
  line(t, C[0] - 1, C[1] - 1, Bp[0], Bp[1] - 1, colors.eave, depth + 0.01);
}

/** Bresenham line. */
export function line(t: Target, x0: number, y0: number, x1: number, y1: number, c: number, d: number, test = false) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const stx = x0 < x1 ? 1 : -1, sty = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    put(t, x0, y0, c, d, test);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += stx; }
    if (e2 <= dx) { err += dx; y0 += sty; }
  }
}

/** Darkens ground pixels inside a convex screen polygon — a building's cast shadow. */
export function groundShadow(t: Target, pts: number[][], k = 0.7) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(t.h - 1, Math.ceil(maxY)); y++)
    for (let x = Math.max(0, Math.floor(minX)); x <= Math.min(t.w - 1, Math.ceil(maxX)); x++) {
      if (!inside(pts, x + 0.5, y + 0.5)) continue;
      const i = y * t.w + x;
      if (t.d[i] === GROUND) t.c[i] = scale(t.c[i], k);
    }
}

function inside(pts: number[][], x: number, y: number) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Darkens ground pixels inside an ellipse with a dithered edge — a soft cast shadow. */
export function shadow(t: Target, cx: number, cy: number, rx: number, ry: number, k = 0.72) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      if (x < 0 || y < 0 || x >= t.w || y >= t.h) continue;
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      const r = dx * dx + dy * dy;
      if (r > 1 || (r > 0.6 && bayer(x, y) < (r - 0.6) / 0.4)) continue;
      const i = y * t.w + x;
      if (t.d[i] !== GROUND) continue;
      t.c[i] = scale(t.c[i], k);
    }
}

/** Pixels on the edge of each region, for hover outlines. */
export function regionOutlines(t: Target) {
  const out = new Map<number, number[]>();
  const r = t.r!;
  for (let y = 1; y < t.h - 1; y++)
    for (let x = 1; x < t.w - 1; x++) {
      const i = y * t.w + x, id = r[i];
      if (!id) continue;
      if (r[i - 1] !== id || r[i + 1] !== id || r[i - t.w] !== id || r[i + t.w] !== id) {
        if (!out.has(id)) out.set(id, []);
        out.get(id)!.push(i);
      }
    }
  return out;
}
