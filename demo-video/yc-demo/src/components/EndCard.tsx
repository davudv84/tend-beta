import { Easing, interpolate, useCurrentFrame } from "remotion";
import { C, FONT } from "../theme";
import { END_START, f } from "../timeline";
import { BrandMark } from "./BrandMark";

const IN = Easing.bezier(0.25, 0.1, 0.25, 1);

/** Near-black, two lines, the real mark, the address. Opacity and a few pixels of travel; nothing scales or glows. */
export const EndCard: React.FC = () => {
  const frame = useCurrentFrame() - f(END_START);
  if (frame < 0) return null;
  const at = (d: number, dur = 36) => interpolate(frame, [d, d + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: IN });
  const bg = at(0, 30);
  const l1 = at(26);
  const l2 = at(40);
  const mark = at(78);
  const url = at(92);
  const line: React.CSSProperties = { fontFamily: FONT.sans, fontWeight: 500, fontSize: 64, lineHeight: 1.12, letterSpacing: "-0.03em" };
  return (
    <div style={{ position: "absolute", inset: 0, background: "#060708", opacity: bg }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 380, textAlign: "center" }}>
        <div style={{ ...line, color: C.text, opacity: l1, transform: `translateY(${(1 - l1) * 6}px)` }}>Powerful agents.</div>
        <div style={{ ...line, color: C.accent, opacity: l2, transform: `translateY(${(1 - l2) * 6}px)` }}>Total control.</div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 640, display: "flex", justifyContent: "center", alignItems: "center", gap: 14, opacity: mark }}>
        <BrandMark size={30} color={C.text} />
        <span style={{ fontFamily: FONT.sans, fontWeight: 600, fontSize: 24, letterSpacing: "0.16em", color: C.text, marginRight: -4 }}>TEND</span>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 692, textAlign: "center", fontFamily: FONT.sans, fontSize: 20, color: C.text2, opacity: url }}>
        tendhq.dev
      </div>
    </div>
  );
};
