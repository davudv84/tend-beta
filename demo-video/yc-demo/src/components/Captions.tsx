import { Easing, interpolate, useCurrentFrame } from "remotion";
import { C, FONT } from "../theme";
import { CAPTIONS, VIEW_H, H, f } from "../timeline";

const IN = Easing.bezier(0.25, 0.1, 0.25, 1);

/**
 * One quiet line of type in the strip under the picture. No labels, no colour coding, no scrim: the product carries
 * the meaning, the line only names it.
 */
export const Captions: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <>
      {CAPTIONS.map((c, i) => {
        const a = f(c.start);
        const b = f(c.end);
        if (frame < a || frame > b + 18) return null;
        const pIn = interpolate(frame, [a, a + 24], [0, 1], { extrapolateRight: "clamp", easing: IN });
        const pOut = interpolate(frame, [b, b + 18], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: 72,
              top: VIEW_H,
              height: H - VIEW_H,
              display: "flex",
              alignItems: "center",
              fontFamily: FONT.sans,
              fontWeight: 500,
              fontSize: 30,
              letterSpacing: "-0.012em",
              color: C.text,
              opacity: pIn * pOut,
              transform: `translateY(${(1 - pIn) * 4}px)`,
              whiteSpace: "nowrap",
            }}
          >
            {c.text}
          </div>
        );
      })}
    </>
  );
};
