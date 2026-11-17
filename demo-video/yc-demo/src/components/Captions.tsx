import { Easing, interpolate, useCurrentFrame } from "remotion";
import { C, FONT } from "../theme";
import { CAPTIONS, f, type Caption } from "../timeline";

const TONE = { blocked: C.blocked, approved: C.approved, accent: C.accent, waiting: C.waiting };
const IN = Easing.bezier(0.16, 1, 0.3, 1);

function renderText(c: Caption) {
  if (!c.em) return c.text;
  const i = c.text.indexOf(c.em.word);
  if (i < 0) return c.text;
  return (
    <>
      {c.text.slice(0, i)}
      <span style={{ color: TONE[c.em.tone] }}>{c.em.word}</span>
      {c.text.slice(i + c.em.word.length)}
    </>
  );
}

/** Lower-left captions on a soft scrim. One statement at a time; enter by opacity and a short rise. */
export const Captions: React.FC = () => {
  const frame = useCurrentFrame();
  // the scrim follows whichever caption is on screen, so it never sits there empty
  let scrim = 0;
  for (const c of CAPTIONS) {
    const v = Math.min(
      interpolate(frame, [f(c.start) - 12, f(c.start) + 6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
      interpolate(frame, [f(c.end) - 6, f(c.end) + 14], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
    );
    scrim = Math.max(scrim, v);
  }
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 360,
          opacity: scrim,
          background: "linear-gradient(to top, rgba(8,9,11,0.94) 0%, rgba(8,9,11,0.82) 38%, rgba(8,9,11,0) 100%)",
        }}
      />
      {CAPTIONS.map((c, i) => {
        const a = f(c.start);
        const b = f(c.end);
        if (frame < a - 2 || frame > b + 14) return null;
        const pIn = interpolate(frame, [a, a + 26], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: IN });
        const pOut = interpolate(frame, [b - 4, b + 12], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        const subIn = interpolate(frame, [a + 10, a + 36], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: IN });
        // consecutive captions with the same kicker keep it steady
        const prev = CAPTIONS[i - 1];
        const keepKicker = prev && prev.kicker === c.kicker && Math.abs(prev.end - c.start) < 0.4;
        const next = CAPTIONS[i + 1];
        const holdKicker = next && next.kicker === c.kicker && Math.abs(c.end - next.start) < 0.4;
        const kO = (keepKicker ? 1 : pIn) * (holdKicker ? 1 : pOut);
        return (
          <div key={i} style={{ position: "absolute", left: 104, bottom: 92, width: 1500 }}>
            {c.kicker ? (
              <div
                style={{
                  fontFamily: FONT.mono,
                  fontSize: 21,
                  letterSpacing: "0.01em",
                  color: C.text2,
                  marginBottom: 18,
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  opacity: kO,
                }}
              >
                <span style={{ width: 9, height: 9, background: C.accent, display: "inline-block" }} />
                {c.kicker}
              </div>
            ) : null}
            <div
              style={{
                fontFamily: FONT.sans,
                fontWeight: 500,
                fontSize: 54,
                lineHeight: 1.12,
                letterSpacing: "-0.022em",
                color: C.text,
                opacity: pIn * pOut,
                transform: `translateY(${(1 - pIn) * 14}px)`,
              }}
            >
              {renderText(c)}
            </div>
            {c.sub ? (
              <div
                style={{
                  fontFamily: FONT.sans,
                  fontWeight: 400,
                  fontSize: 28,
                  lineHeight: 1.3,
                  letterSpacing: "-0.01em",
                  color: C.text2,
                  marginTop: 14,
                  opacity: subIn * pOut,
                  transform: `translateY(${(1 - subIn) * 10}px)`,
                }}
              >
                {c.sub}
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
};
