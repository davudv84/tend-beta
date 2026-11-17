import { useCurrentFrame } from "remotion";
import { speedAt } from "../speed";
import { C, FONT } from "../theme";
import { FPS, H, VIEW_H } from "../timeline";

const fmt = (x: number) => (Math.abs(x - Math.round(x)) < 0.05 ? `${Math.round(x)}` : x.toFixed(1));

/** Honest-time note, right side of the caption strip: shown only while footage plays faster than it happened. */
export const SpeedTag: React.FC = () => {
  const t = useCurrentFrame() / FPS;
  const samples = [-0.15, -0.075, 0, 0.075, 0.15].map((d) => speedAt(t + d));
  const fast = samples.filter((s) => s > 1.05);
  if (!fast.length) return null;
  const x = speedAt(t) > 1.05 ? speedAt(t) : Math.max(...fast);
  return (
    <div
      style={{
        position: "absolute",
        right: 72,
        top: VIEW_H,
        height: H - VIEW_H,
        display: "flex",
        alignItems: "center",
        fontFamily: FONT.mono,
        fontSize: 16,
        color: C.text2,
        opacity: (fast.length / samples.length) * 0.9,
      }}
    >
      {fmt(x)}× while waiting for the model
    </div>
  );
};
