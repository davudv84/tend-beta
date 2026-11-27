// The passage's choreography (passage.tsx): every moving value as keyframes over the scroll progress `s`, 0 at the hero and 1 when the
// stack has settled flat on the last screen. Pure functions, so the server's first frame and the client's engine agree.
//
// Four planes, one real TEND screen each: Connect, Control, Approve, Monitor. The hero shrinks into the first plane; the plane opens
// into a stack, and the stack advances one plane per step. Only the plane in front is lit. The ones still to come wait behind it, dark;
// the one just explained darkens first and only then lifts away, so two screens are never seen through each other. The camera turns
// the stack a little to one side per step, so the text is always on the open side. At the end the stack settles flat.

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

/** The stages' holds, in progress. Stage 0 is the hero; 1–4 are Connect, Control, Approve, Monitor. The last hold runs to the end. */
export const HOLDS: readonly (readonly [number, number])[] = [
  [0, 0.07], [0.15, 0.27], [0.37, 0.49], [0.59, 0.71], [0.82, 1.01],
];
/** Where each stage's text sits: under the stack, or on the open side of it. */
export const SIDE = ["center", "left", "right", "left", "center"] as const;
export const HERO_END = 0.07;

// The camera. x in vw, y in vh, angles in degrees, dolly in px of scene space. One small turn per step and no roll: a plane always
// faces the reader enough to be read.
const X: Track = [[0, 0], [0.07, 0], [0.15, 10], [0.27, 10], [0.37, -10], [0.49, -10], [0.59, 10], [0.71, 10], [0.82, 0]];
const Y: Track = [[0, 0], [0.07, 0], [0.15, -3], [0.71, -3], [0.82, -4]];
const RY: Track = [[0, 0], [0.07, 0], [0.15, 12], [0.27, 12], [0.37, -12], [0.49, -12], [0.59, 12], [0.71, 12], [0.82, 0]];
const RX: Track = [[0, 0], [0.07, 0], [0.15, 5], [0.71, 5], [0.82, 2], [0.9, 0]];
// A slow push-in through every hold (the camera is never quite still while a step is read), eased back between steps.
const DOLLY: Track = [
  [0, 0], [0.07, 0], [0.15, -60], [0.27, -18], [0.37, -60], [0.49, -18], [0.59, -60], [0.71, -18], [0.82, -30], [0.9, 0],
];
/** The space between planes: closed in the hero, open while the stack is read, closed again as it settles flat. */
const GAP: Track = [[0, 0], [0.07, 0], [0.15, 150], [0.71, 150], [0.82, 110], [0.9, 0]];
/** The stack's final size: the last screen ends a little larger than a plane. */
const FINAL: Track = [[0.88, 1], [0.97, 1.2]];

/** How present stage `k` is: 1 on its hold, crossing over in the middle of the turn on either side. */
export function weight(s: number, k: number) {
  const f = 0.06;
  const [a, b] = HOLDS[k];
  const prev = k > 0 ? (HOLDS[k - 1][1] + a) / 2 : -1;
  const next = k < HOLDS.length - 1 ? (b + HOLDS[k + 1][0]) / 2 : 2;
  return Math.min(clamp((s - prev) / f + 0.5), clamp((next - s) / f + 0.5));
}

export type Frame = ReturnType<typeof frame>;
export const PLANES = 4;

/** `mobile`: a phone (portrait planes). `centered`: anything narrower than a desktop, where the text sits under the stack, so the
 *  stack stays in the middle and turns less. */
export function frame(s: number, mobile: boolean, centered = mobile) {
  const r = mobile ? 0.5 : centered ? 0.65 : 1;
  const gap = at(GAP, s) * (mobile ? 0.7 : 1);
  const weights = HOLDS.map((_, k) => weight(s, k));
  // Which plane is in front, continuously: 0 on Connect … 3 on Monitor.
  const p = weights.reduce((sum, w, k) => sum + (k > 0 ? w * (k - 1) : 0), 0);
  const appear = clamp((s - HERO_END) / 0.03);
  return {
    x: centered ? 0 : at(X, s),
    y: centered ? (mobile ? -2 : 3) * clamp((s - 0.07) / 0.08) : at(Y, s),
    rx: at(RX, s) * r,
    ry: at(RY, s) * r,
    dolly: at(DOLLY, s),
    final: at(FINAL, s) * (mobile ? 0.9 : 1),
    gap,
    planes: Array.from({ length: PLANES }, (_, i) => {
      const d = i - p; // < 0: already explained; 0: in front; > 0: still to come
      // Explained: dark by d = -0.25, then lifts and fades (a dark fade only darkens what is behind it). To come: dark, opaque.
      const dim = d < 0 ? clamp(-d * 4) : 0.8 * clamp(d * 1.4);
      const opacity = d < 0 ? 1 - clamp((-d - 0.25) / 0.25) : 1;
      return { z: -d * gap, y: d < 0 ? d * 150 : -d * 40 * (gap / 150), dim, opacity: opacity * appear };
    }),
    weights,
    /** The hero picture's shrink into the first plane, 0 → 1. */
    shrink: ease(clamp(s / HERO_END)),
    heroText: 1 - clamp((s - 0.004) / 0.028),
    heroOut: clamp((s - HERO_END) / 0.03),
  };
}

/** A stage's text: in after its turn settles, out before the next turn (the last one stays). */
export function captionAt(s: number, k: number) {
  const [a, b] = HOLDS[k];
  const fade = 0.03;
  const last = k === HOLDS.length - 1;
  const op = Math.min(clamp((s - a + 0.01) / fade), last ? 1 : clamp((b + 0.02 - s) / fade));
  const y = s < (a + b) / 2 ? 14 * (1 - op) : -14 * (1 - op);
  return { op, y };
}
