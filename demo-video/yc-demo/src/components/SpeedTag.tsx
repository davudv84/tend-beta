import { useCurrentFrame } from "remotion";
import { speedAt } from "../speed";
import { C, FONT } from "../theme";
import { FPS } from "../timeline";

const fmt = (x: number) => (Math.abs(x - Math.round(x)) < 0.05 ? `${Math.round(x)}` : x.toFixed(1));

/**
 * Honest-time disclosure: visible whenever what's on screen plays faster than it happened (the original recording's
 * own model-wait speed-ups). Never shown for real-time or slowed footage.
 */
export const SpeedTag: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const samples = [-0.12, -0.06, 0, 0.06, 0.12].map((d) => speedAt(t + d));
  const fast = samples.filter((s) => s > 1.05);
  const o = fast.length / samples.length;
  if (o <= 0) return null;
  const x = speedAt(t) > 1.05 ? speedAt(t) : Math.max(...fast);
  return (
    <div
      style={{
        position: "absolute",
        top: 54,
        right: 64,
        opacity: o,
        fontFamily: FONT.mono,
        fontSize: 20,
        color: C.text,
        background: "rgba(8,9,11,0.78)",
        border: `1px solid ${C.hairline}`,
        borderRadius: 6,
        padding: "9px 14px",
        display: "flex",
        gap: 10,
        alignItems: "center",
      }}
    >
      <span style={{ color: C.waiting }}>{fmt(x)}×</span>
      <span style={{ color: C.text2 }}>waiting for the model · sped up</span>
    </div>
  );
};
