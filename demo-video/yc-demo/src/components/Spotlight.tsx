import { Easing, interpolate, useCurrentFrame } from "remotion";
import { C } from "../theme";
import { f, type Spot } from "../timeline";

const TONE = { blocked: C.blocked, approved: C.approved, accent: C.accent, waiting: C.waiting };
const OUT = Easing.bezier(0.2, 0, 0, 1);

/**
 * Focus highlight on a real UI element: everything else on the plate dims, and a hairline frames the element.
 * The element itself is never retouched. `scale` converts plate source px to world units; `z` keeps the hairline
 * one screen pixel wide at any zoom.
 */
export const Spotlight: React.FC<{ spot: Spot; scale: number; z: number }> = ({ spot, scale, z }) => {
  const frame = useCurrentFrame();
  const a = f(spot.start);
  const b = f(spot.end);
  if (frame < a || frame > b) return null;
  const inP = interpolate(frame, [a, a + 22], [0, 1], { extrapolateRight: "clamp", easing: OUT });
  const outP = interpolate(frame, [b - 16, b], [1, 0], { extrapolateLeft: "clamp" });
  const o = Math.min(inP, outP);
  const grow = (1 - inP) * 10; // settles inward onto the element
  const pad = 6;
  const px = 1 / z;
  const color = TONE[spot.tone];
  return (
    <div
      style={{
        position: "absolute",
        left: (spot.x - pad - grow) * scale,
        top: (spot.y - pad - grow) * scale,
        width: (spot.w + 2 * (pad + grow)) * scale,
        height: (spot.h + 2 * (pad + grow)) * scale,
        borderRadius: 6 * scale,
        boxShadow: `0 0 0 4000px rgba(8,9,11,${(spot.dim ?? 0.42) * o})`,
        pointerEvents: "none",
      }}
    >
      <div style={{ position: "absolute", inset: 0, borderRadius: 6 * scale, boxShadow: `0 0 0 ${1.5 * px}px ${color}`, opacity: o }} />
    </div>
  );
};
