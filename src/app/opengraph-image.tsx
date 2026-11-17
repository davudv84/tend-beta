import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

// The shared-link card (WhatsApp, Slack, LinkedIn, X), in the homepage's look: the painted valley, the TEND dashboard screenshot in the gap, and
// the line beside it. Generated from this file, so there is no image to keep in sync.
export const alt = "The TEND dashboard over a painted valley at dusk: Your AI agents ask. You decide.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const TEXT = "#ededed", MUTED = "#b5b5b5", GREEN = "#5fb892";

function Mark({ size: s, color }: { size: number; color: string }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <path d="M19 4.5H5.5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1H19" stroke={color} strokeWidth="2" strokeLinecap="square" />
      <rect x="9" y="9" width="6" height="6" fill={color} />
      <path d="M15 12h7" stroke={color} strokeWidth="2" />
    </svg>
  );
}

export default async function Image() {
  const bg = await readFile(path.join(process.cwd(), "src/app/og-valley.jpg"));
  const src = `data:image/jpeg;base64,${bg.toString("base64")}`;
  const dashFile = await readFile(path.join(process.cwd(), "src/app/og-dashboard.png"));
  const dash = `data:image/png;base64,${dashFile.toString("base64")}`;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", fontFamily: "sans-serif", background: "#181818" }}>
        <img src={src} width={1200} height={630} alt="" style={{ position: "absolute", inset: 0 }} />
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 260, display: "flex", background: "linear-gradient(to bottom, rgba(24,24,24,0), #181818)" }} />
        {/* The dashboard, in the gap. */}
        <div style={{ position: "absolute", left: 36, top: 151, width: 572, height: 328, display: "flex", borderRadius: 12, border: "1px solid #3a3a3a", overflow: "hidden", boxShadow: "0 24px 60px rgba(0,0,0,0.55)" }}>
          <img src={dash} width={570} height={326} alt="" />
        </div>
        {/* The line. */}
        <div style={{ position: "absolute", left: 640, top: 0, bottom: 0, right: 64, display: "flex", flexDirection: "column", justifyContent: "center", gap: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Mark size={36} color={GREEN} />
            <div style={{ display: "flex", fontSize: 26, fontWeight: 700, color: TEXT, letterSpacing: 6 }}>TEND</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 62, fontWeight: 700, color: TEXT, lineHeight: 1.04, letterSpacing: -2 }}>
            <div style={{ display: "flex" }}>Your AI agents ask.</div>
            <div style={{ display: "flex" }}>You decide.</div>
          </div>
          <div style={{ display: "flex", fontSize: 25, color: MUTED, lineHeight: 1.4 }}>Risky tool calls wait for your yes, then run exactly once.</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
