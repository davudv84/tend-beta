import { Easing, interpolate, useCurrentFrame } from "remotion";
import { f, type Spot } from "../timeline";

const OUT = Easing.bezier(0.25, 0.1, 0.25, 1);

/**
 * Rare emphasis: the rest of the plate falls back a little, with a feathered edge. No outline, no glow; the element
 * itself is never touched.
 */
export const Spotlight: React.FC<{ spot: Spot; scale: number }> = ({ spot, scale }) => {
  const frame = useCurrentFrame();
  const a = f(spot.start);
  const b = f(spot.end);
  if (frame < a || frame > b) return null;
  const o = Math.min(
    interpolate(frame, [a, a + 40], [0, 1], { extrapolateRight: "clamp", easing: OUT }),
    interpolate(frame, [b - 30, b], [1, 0], { extrapolateLeft: "clamp" }),
  );
  return (
    <div
      style={{
        position: "absolute",
        left: spot.x * scale,
        top: spot.y * scale,
        width: spot.w * scale,
        height: spot.h * scale,
        boxShadow: `0 0 ${36 * scale}px ${3000}px rgba(8,9,11,${(spot.dim ?? 0.4) * o})`,
        pointerEvents: "none",
      }}
    />
  );
};
