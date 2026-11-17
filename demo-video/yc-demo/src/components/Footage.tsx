import { OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { FPS, SEGMENTS, f } from "../timeline";

/**
 * One plate of the original recording, with the edit's segments laid out in time. Both plates use the same
 * SEGMENTS, so the dashboard and the terminal always show the same instant of the real session.
 */
export const Footage: React.FC<{ file: "dash" | "term" }> = ({ file }) => {
  const frame = useCurrentFrame();
  return (
    <>
      {SEGMENTS.map((s, i) => {
        const fade = s.fadeIn ?? 0;
        const from = f(s.start - fade);
        const dur = f(s.end) - from;
        const opacity = fade > 0 ? interpolate(frame, [from, f(s.start)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
        const trimBefore = Math.round((s.src - fade * s.rate) * FPS);
        return (
          <Sequence key={i} from={from} durationInFrames={dur} layout="none">
            <div style={{ position: "absolute", inset: 0, opacity }}>
              <OffthreadVideo
                src={staticFile(`footage/${file}.mp4`)}
                trimBefore={trimBefore}
                playbackRate={s.rate}
                muted
                style={{ width: "100%", height: "100%", display: "block" }}
              />
            </div>
          </Sequence>
        );
      })}
    </>
  );
};
