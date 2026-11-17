import { AbsoluteFill, Audio, interpolate, staticFile, useCurrentFrame } from "remotion";
import { cameraAt } from "./camera";
import { Captions } from "./components/Captions";
import { EndCard } from "./components/EndCard";
import { Footage } from "./components/Footage";
import { SpeedTag } from "./components/SpeedTag";
import { Spotlight } from "./components/Spotlight";
import { loadFonts } from "./fonts";
import { C } from "./theme";
import { DASH, END_START, FOCUS, FPS, SPOTS, TERM, TERM_SCALE, f, type Focus } from "./timeline";

loadFonts();

const W = 1920;
const H = 1080;
// The camera aims above frame centre: the lower third belongs to the captions.
const CY = H / 2 - 70;

/** 0..1 attention for a plate, eased across focus changes (0.5 s cross-dim). */
function attention(t: number, plate: "dash" | "term") {
  const on = (x: Focus) => (x === "both" || x === plate ? 1 : 0);
  let v = on(FOCUS[0].focus);
  for (let i = 1; i < FOCUS.length; i++) {
    const k = FOCUS[i];
    const p = Math.min(1, Math.max(0, (t - k.t) / 0.5));
    const eased = p * p * (3 - 2 * p);
    v = v + (on(k.focus) - v) * eased;
  }
  return v;
}

const Plate: React.FC<{ which: "dash" | "term"; z: number; t: number }> = ({ which, z, t }) => {
  const r = which === "dash" ? DASH : TERM;
  const scale = which === "dash" ? 1 : TERM_SCALE;
  const a = attention(t, which);
  const px = 1 / z;
  return (
    <div
      style={{
        position: "absolute",
        left: r.x,
        top: r.y,
        width: r.w,
        height: r.h,
        borderRadius: 10,
        overflow: "hidden",
        background: which === "dash" ? "#ffffff" : "#0d1211",
        boxShadow: `0 0 0 ${px}px rgba(255,255,255,0.10), 0 ${24 * px}px ${80 * px}px rgba(0,0,0,0.55)`,
      }}
    >
      <Footage file={which} />
      {SPOTS.filter((s) => s.plate === which).map((s, i) => (
        <Spotlight key={i} spot={s} scale={scale} z={z} />
      ))}
      {/* attention: the plate that is not the subject steps back */}
      <div style={{ position: "absolute", inset: 0, background: C.bg, opacity: (1 - a) * 0.72 }} />
    </div>
  );
};

export const Demo: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const cam = cameraAt(t);
  const fadeIn = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: "clamp" });
  const worldOut = interpolate(frame, [f(END_START), f(END_START) + 30], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  // the room light drifts a little against the camera: depth without decoration
  const lx = 50 - (cam.at.x / 1869 - 0.5) * 8;
  const ly = 46 - (cam.at.y / 940 - 0.5) * 8;
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 70% 60% at ${lx}% ${ly}%, ${C.bg2} 0%, ${C.bg} 70%)` }} />
      {frame < f(END_START) + 32 ? (
        <AbsoluteFill style={{ opacity: fadeIn * worldOut }}>
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              transformOrigin: "0 0",
              transform: `translate(${W / 2}px, ${CY}px) scale(${cam.z}) translate(${-cam.at.x}px, ${-cam.at.y}px)`,
            }}
          >
            <Plate which="dash" z={cam.z} t={t} />
            <Plate which="term" z={cam.z} t={t} />
          </div>
          {/* lens falloff */}
          <AbsoluteFill style={{ background: "radial-gradient(ellipse 85% 85% at 50% 50%, rgba(0,0,0,0) 60%, rgba(0,0,0,0.28) 100%)" }} />
          <Captions />
          <SpeedTag />
        </AbsoluteFill>
      ) : null}
      <EndCard />
      <Audio src={staticFile("audio/score.wav")} />
    </AbsoluteFill>
  );
};
