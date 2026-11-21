// The passage's choreography (passage.tsx): every moving value as keyframes over the scroll progress `s`, 0 at the hero and 1 when the
// layers have folded flat into the product. Pure functions, so the server's first frame and the client's engine agree.
//
// The motion follows the reference's grammar: the hero picture shrinks into a plane, the plane tilts into a stack of same-size layers
// with wide gaps, and the camera swings the stack from side to side, one stage per swing, the text always on the open side. Between
// two stages the gaps close, the content changes while the layers are together, and the gaps open again.

type Track = readonly (readonly [number, number])[];

/** Smootherstep: no velocity jump where two keyframe segments meet. */
const ease = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

export function at(track: Track, s: number): number {
  if (s <= track[0][0]) return track[0][1];
  for (let i = 1; i < track.length; i++) {
    const [s1, v1] = track[i];
    if (s <= s1) {
      const [s0, v0] = track[i - 1];
      return v0 + (v1 - v0) * ease((s - s0) / (s1 - s0));
    }
  }
  return track[track.length - 1][1];
}

/** The stages' holds, in progress. Stage 0 is the hero; 1–5 the request's steps; 6 the product. */
export const HOLDS: readonly (readonly [number, number])[] = [
  [0, 0.06], [0.1, 0.2], [0.26, 0.36], [0.42, 0.52], [0.58, 0.68], [0.74, 0.84], [0.93, 1.01],
];
/** Where each stage's text sits: under the stack, or on the open side of it. */
export const SIDE = ["center", "center", "left", "right", "left", "right", "center"] as const;
export const HERO_END = 0.06;

// The camera. x in vw, y in vh, angles in degrees, dolly in px of scene space.
const X: Track = [[0, 0], [0.08, 0], [0.2, 0], [0.26, 15], [0.36, 15], [0.42, -13], [0.52, -13], [0.58, 15], [0.68, 15], [0.74, -13], [0.84, -13], [0.93, 0]];
const Y: Track = [[0, 0], [0.075, 0], [0.12, -9], [0.2, -9], [0.26, -1], [0.84, -1], [0.93, -9]];
const RY: Track = [[0, 0], [0.075, 0], [0.13, 24], [0.2, 22], [0.26, 31], [0.36, 28], [0.42, -31], [0.52, -28], [0.58, 31], [0.68, 28], [0.74, -31], [0.84, -28], [0.93, 0]];
const RX: Track = [[0, 0], [0.075, 0], [0.13, 9], [0.2, 7], [0.26, 8], [0.36, 6], [0.42, 9], [0.52, 7], [0.58, 8], [0.68, 6], [0.74, 9], [0.84, 7], [0.93, 0]];
const RZ: Track = [[0, 0], [0.13, -1.5], [0.36, 1], [0.52, -1], [0.68, 1], [0.84, -1], [0.93, 0]];
const DOLLY: Track = [[0, 0], [0.075, 0], [0.13, -80], [0.2, -40], [0.26, -110], [0.36, -70], [0.42, -110], [0.52, -70], [0.58, -110], [0.68, -70], [0.74, -110], [0.84, -70], [0.93, 0]];
/** The space between layers: closed in the hero, wide on each hold, closing between holds while the content changes. */
const GAP: Track = [[0, 0], [0.075, 0], [0.13, 175], [0.2, 185], [0.23, 60], [0.26, 190], [0.36, 195], [0.39, 60], [0.42, 195], [0.52, 195], [0.55, 60], [0.58, 195], [0.68, 195], [0.71, 60], [0.74, 200], [0.84, 205], [0.92, 0]];
/** The stack's final size: the product screen ends larger than a layer. */
const FINAL: Track = [[0.84, 1], [0.93, 1.32]];
const LINES: Track = [[0.07, 0], [0.12, 1], [0.84, 1], [0.9, 0]];

/** How present stage `k`'s content is: 1 on its hold, crossfading in the middle of the swing on either side. */
export function weight(s: number, k: number) {
  const f = 0.022;
  const [a, b] = HOLDS[k];
  const prev = k > 0 ? (HOLDS[k - 1][1] + a) / 2 : -1;
  const next = k < HOLDS.length - 1 ? (b + HOLDS[k + 1][0]) / 2 : 2;
  return Math.min(clamp((s - prev) / f + 0.5), clamp((next - s) / f + 0.5));
}

export type Frame = ReturnType<typeof frame>;
export const LAYERS = 5;
/** The layer that carries the picture; the others are line drawings in front of and behind it. */
export const IMAGE_LAYER = 1;
/** Each layer's place along z, in gaps from the picture: the outline of what TEND looks at sits just in front of it (so it stays on its
 *  target), the fields it reads further forward, the tracing and the path behind. */
const DEPTH = [0.28, 0, -1, 0.95, -2];

export function frame(s: number, mobile: boolean) {
  const r = mobile ? 0.55 : 1;
  const gap = at(GAP, s) * (mobile ? 0.7 : 1);
  const lines = at(LINES, s);
  return {
    x: mobile ? 0 : at(X, s),
    y: mobile ? -10 * clamp((s - 0.07) / 0.05) : at(Y, s),
    rx: at(RX, s) * r,
    ry: at(RY, s) * r,
    rz: at(RZ, s) * r,
    dolly: at(DOLLY, s),
    final: at(FINAL, s) * (mobile ? 0.8 : 1),
    gap,
    layers: Array.from({ length: LAYERS }, (_, i) => ({
      z: DEPTH[i] * gap,
      opacity: i === IMAGE_LAYER ? clamp((s - HERO_END) / 0.012) : lines,
    })),
    weights: HOLDS.map((_, k) => weight(s, k)),
    /** The hero picture's shrink into the image layer, 0 → 1. */
    shrink: ease(clamp(s / HERO_END)),
    heroText: 1 - clamp((s - 0.004) / 0.028),
    heroOut: clamp((s - HERO_END) / 0.012),
  };
}

/** A stage's text: in after its swing settles, out before the next swing (the last one stays). */
export function captionAt(s: number, k: number) {
  const [a, b] = HOLDS[k];
  const fade = 0.02;
  const last = k === HOLDS.length - 1;
  const op = Math.min(clamp((s - a + 0.006) / fade), last ? 1 : clamp((b + 0.012 - s) / fade));
  const y = s < (a + b) / 2 ? 16 * (1 - op) : -16 * (1 - op);
  return { op, y };
}
