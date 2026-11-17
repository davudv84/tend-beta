import { Easing, interpolate, useCurrentFrame } from "remotion";
import { C, FONT } from "../theme";
import { END_START, f } from "../timeline";
import { BrandMark } from "./BrandMark";

const IN = Easing.bezier(0.16, 1, 0.3, 1);

export const EndCard: React.FC = () => {
  const frame = useCurrentFrame() - f(END_START);
  if (frame < 0) return null;
  const rise = (d: number, dur = 40) => interpolate(frame, [d, d + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: IN });
  const bg = interpolate(frame, [0, 36], [0, 1], { extrapolateRight: "clamp" });
  const l1 = rise(40);
  const l2 = rise(58);
  const mark = rise(104, 50);
  const url = rise(124, 50);
  // the square in the mark travels through the opening once: the product, in one gesture
  const travel = interpolate(frame, [104, 170], [-4, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: IN });
  const line: React.CSSProperties = {
    fontFamily: FONT.sans,
    fontWeight: 600,
    fontSize: 104,
    lineHeight: 1.0,
    letterSpacing: "-0.035em",
  };
  return (
    <div style={{ position: "absolute", inset: 0, background: C.bg, opacity: bg }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 318, textAlign: "center" }}>
        <div style={{ ...line, color: C.text, opacity: l1, transform: `translateY(${(1 - l1) * 18}px)` }}>POWERFUL AGENTS.</div>
        <div style={{ ...line, color: C.accent, marginTop: 14, opacity: l2, transform: `translateY(${(1 - l2) * 18}px)` }}>TOTAL CONTROL.</div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 676,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: 18,
          opacity: mark,
        }}
      >
        <div style={{ width: 44, height: 44, position: "relative", overflow: "visible" }}>
          <svg viewBox="0 0 24 24" width={44} height={44} fill="none" style={{ position: "absolute", inset: 0, overflow: "visible" }}>
            <path d="M19 4.5H5.5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1H19" stroke={C.text} strokeWidth="2" strokeLinecap="square" />
            <g transform={`translate(${travel} 0)`}>
              <rect x="9" y="9" width="6" height="6" fill={C.accent} />
              <path d="M15 12h7" stroke={C.accent} strokeWidth="2" />
            </g>
          </svg>
        </div>
        <span style={{ fontFamily: FONT.sans, fontWeight: 600, fontSize: 38, letterSpacing: "0.16em", color: C.text, marginRight: -6 }}>TEND</span>
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 760,
          textAlign: "center",
          fontFamily: FONT.mono,
          fontSize: 26,
          color: C.text2,
          opacity: url,
        }}
      >
        tendhq.dev
      </div>
    </div>
  );
};

export { BrandMark };
