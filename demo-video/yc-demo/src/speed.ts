import { srcAt } from "./timeline";

/**
 * Windows of the ORIGINAL recording that were already played faster while Claude Code waited for the model.
 * Detected from the original's own on-screen badge ("2x/1.5x · waiting for the model"); the badge pixels are painted
 * out of the dashboard plate (scripts/prepare-footage.sh) and this disclosure takes their place, in every shot,
 * including terminal close-ups where the original badge would not have been visible at all.
 */
export const SOURCE_SPEEDUPS: { from: number; to: number; x: number }[] = [
  { from: 18.7, to: 20.4, x: 2 },
  { from: 21.9, to: 23.7, x: 1.5 },
  { from: 28.7, to: 30.0, x: 2 },
  { from: 31.8, to: 34.1, x: 1.5 },
  { from: 43.7, to: 45.1, x: 2 },
  { from: 51.4, to: 53.6, x: 1.5 },
];

/** Effective playback speed relative to real time at output time t (1 = real time). */
export function speedAt(t: number): number {
  const s = srcAt(t);
  if (!s) return 1;
  const w = SOURCE_SPEEDUPS.find((w) => s.src >= w.from && s.src < w.to);
  return (w ? w.x : 1) * s.rate;
}
