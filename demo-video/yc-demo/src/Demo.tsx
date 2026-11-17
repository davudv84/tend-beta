import { AbsoluteFill, Audio, interpolate, staticFile, useCurrentFrame } from "remotion";
import { cameraAt } from "./camera";
import { Captions } from "./components/Captions";
import { EndCard } from "./components/EndCard";
import { Footage } from "./components/Footage";
import { SpeedTag } from "./components/SpeedTag";
import { Spotlight } from "./components/Spotlight";
import { loadFonts } from "./fonts";
import { C } from "./theme";
import { DASH, END_START, FOCUS, FPS, SPOTS, TERM, TERM_SCALE, VIEW_H, W, WORLD, f, type Focus } from "./timeline";

loadFonts();

/** 0..1 attention for a panel, eased across focus changes (0.6 s). */
function attention(t: number, plate: "dash" | "term") {
  const on = (x: Focus) => (x === "both" || x === plate ? 1 : 0);
  let v = on(FOCUS[0].focus);
  for (let i = 1; i < FOCUS.length; i++) {
    const p = Math.min(1, Math.max(0, (t - FOCUS[i].t) / 0.6));
    v += (on(FOCUS[i].focus) - v) * p * p * (3 - 2 * p);
  }
  return v;
}

const Panel: React.FC<{ which: "dash" | "term"; t: number }> = ({ which, t }) => {
  const r = which === "dash" ? DASH : TERM;
  const scale = which === "dash" ? 1 : TERM_SCALE;
  return (
    <div style={{ position: "absolute", left: r.x, top: r.y, width: r.w, height: r.h, overflow: "hidden", background: which === "dash" ? "#fff" : "#0d1211" }}>
      <Footage file={which} />
      {SPOTS.filter((s) => s.plate === which).map((s, i) => (
        <Spotlight key={i} spot={s} scale={scale} />
      ))}
      {/* the panel that is not the subject steps back, gently */}
      <div style={{ position: "absolute", inset: 0, background: C.bg, opacity: (1 - attention(t, which)) * 0.4 }} />
    </div>
  );
};

export const Demo: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const cam = cameraAt(t);
  const fadeIn = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });
  const out = interpolate(frame, [f(END_START), f(END_START) + 30], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {frame < f(END_START) + 32 ? (
        <AbsoluteFill style={{ opacity: fadeIn * out }}>
          {/* picture area */}
          <div style={{ position: "absolute", left: 0, top: 0, width: W, height: VIEW_H, overflow: "hidden" }}>
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: WORLD.w,
                height: WORLD.h,
                transformOrigin: "0 0",
                transform: `translate(${W / 2}px, ${VIEW_H / 2}px) scale(${cam.z}) translate(${-cam.at.x}px, ${-cam.at.y}px)`,
                outline: `${1 / cam.z}px solid rgba(255,255,255,0.06)`,
              }}
            >
              <Panel which="dash" t={t} />
              <Panel which="term" t={t} />
            </div>
          </div>
          <Captions />
          <SpeedTag />
        </AbsoluteFill>
      ) : null}
      <EndCard />
      <Audio src={staticFile("audio/score.wav")} />
    </AbsoluteFill>
  );
};
