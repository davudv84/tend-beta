import { Easing } from "remotion";
import { CAMERA, type Cam, type Pt } from "./timeline";

// Moves: a slow, weighted start and a long, soft landing (no overshoot, no springs).
const MOVE = Easing.bezier(0.55, 0.0, 0.12, 1.0);
// Settles: arrive from a move that is already in flight, so start faster and land long.
const SETTLE = Easing.bezier(0.3, 0.2, 0.1, 1.0);
// Drifts: the camera never fully stops; a near-linear creep with eased ends.
const DRIFT = Easing.bezier(0.33, 0.0, 0.67, 1.0);

function ease(k: Cam["ease"]) {
  return k === "drift" ? DRIFT : k === "settle" ? SETTLE : MOVE;
}

/**
 * Camera state at output time t. Zoom is interpolated in log space (equal ratios feel like equal speed), and the
 * look-at point is interpolated in *screen* terms so a zoom-out-and-pan does not swing past its target.
 */
export function cameraAt(t: number): { at: Pt; z: number } {
  const keys = CAMERA;
  if (t <= keys[0].t) return { at: keys[0].at, z: keys[0].z };
  const last = keys[keys.length - 1];
  if (t >= last.t) return { at: last.at, z: last.z };
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const p = ease(b.ease)((t - a.t) / (b.t - a.t));
  const lz = Math.log(a.z) + (Math.log(b.z) - Math.log(a.z)) * p;
  const z = Math.exp(lz);
  // weight the pan by how far the zoom has progressed in screen space, so targets stay put on screen while zooming
  const wz = a.z === b.z ? p : (1 / a.z - 1 / z) / (1 / a.z - 1 / b.z);
  const w = Number.isFinite(wz) ? Math.min(1, Math.max(0, wz)) : p;
  return { at: { x: a.at.x + (b.at.x - a.at.x) * w, y: a.at.y + (b.at.y - a.at.y) * w }, z };
}
