import { Easing, interpolate, useCurrentFrame } from "remotion";
import { C, FONT } from "../theme";
import { END_START, FPS, f } from "../timeline";
import { BrandMark } from "./BrandMark";

const IN = Easing.bezier(0.25, 0.1, 0.25, 1);

/** Black, the real TEND mark, the line, the address. Opacity and a few pixels of travel; nothing scales or glows. */
export const EndCard: React.FC = () => {
  const frame = useCurrentFrame() - f(END_START);
  if (frame < 0) return null;
  const s = (sec: number) => (sec * FPS) / 30; // timings below are written at 30 fps
  const at = (d: number, dur = 18) =>
    interpolate(frame, [s(d), s(d + dur)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: IN });
  const bg = at(0, 15);
  const mark = at(12);
  const l1 = at(24);
  const l2 = at(32);
  const url = at(46);
  const line: React.CSSProperties = { fontFamily: FONT.sans, fontWeight: 500, fontSize: 60, lineHeight: 1.12, letterSpacing: "-0.03em" };
  return (
    <div style={{ position: "absolute", inset: 0, background: "#050506", opacity: bg }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 330, display: "flex", justifyContent: "center", alignItems: "center", gap: 16, opacity: mark }}>
        <BrandMark size={40} color={C.text} />
        <span style={{ fontFamily: FONT.sans, fontWeight: 600, fontSize: 32, letterSpacing: "0.16em", color: C.text, marginRight: -5 }}>TEND</span>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 432, textAlign: "center" }}>
        <div style={{ ...line, color: C.text, opacity: l1, transform: `translateY(${(1 - l1) * 6}px)` }}>Powerful agents.</div>
        <div style={{ ...line, color: C.accent, opacity: l2, transform: `translateY(${(1 - l2) * 6}px)` }}>Total control.</div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 616, textAlign: "center", fontFamily: FONT.sans, fontSize: 24, color: C.text2, opacity: url }}>
        tendhq.dev
      </div>
    </div>
  );
};
