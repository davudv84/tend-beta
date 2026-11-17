import { Easing } from "remotion";
import { CAMERA, type Cam, type Pt } from "./timeline";

// Moves: a slow, weighted start and a long, soft landing. No overshoot, no springs.
const MOVE = Easing.bezier(0.6, 0.0, 0.1, 1.0);
// Holds: the camera never fully freezes; an almost imperceptible creep with soft ends.
const HOLD = Easing.bezier(0.4, 0.0, 0.6, 1.0);

/**
 * Camera at output time t. Zoom is interpolated in log space (equal ratios read as equal speed); the look-at point is
 * weighted in screen terms so a target stays put while the lens zooms; long traverses arc back by `dip` mid-move.
 */
export function cameraAt(t: number): { at: Pt; z: number } {
  const keys = CAMERA;
  if (t <= keys[0].t) return { at: keys[0].at, z: keys[0].z };
  const last = keys[keys.length - 1];
  if (t >= last.t) return { at: last.at, z: last.z };
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
  const a: Cam = keys[i];
  const b: Cam = keys[i + 1];
  const raw = (t - a.t) / (b.t - a.t);
  const p = (b.ease === "hold" ? HOLD : MOVE)(raw);
  const z0 = Math.exp(Math.log(a.z) + (Math.log(b.z) - Math.log(a.z)) * p);
  const wz = Math.abs(a.z - b.z) < 1e-6 ? p : (1 / a.z - 1 / z0) / (1 / a.z - 1 / b.z);
  const w = Number.isFinite(wz) ? Math.min(1, Math.max(0, wz)) : p;
  const dip = b.dip ? 1 - b.dip * Math.sin(Math.PI * p) : 1;
  return { at: { x: a.at.x + (b.at.x - a.at.x) * w, y: a.at.y + (b.at.y - a.at.y) * w }, z: z0 * dip };
}
