import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

// The shared-link card (WhatsApp, Slack, LinkedIn, X), in the homepage's look: the painted valley, TEND on a phone with its approval
// notification standing in the bright gap, and the line beside it. Generated from this file, so there is no image to keep in sync.
export const alt = "TEND on a phone, showing an approval notification over a painted valley at dusk: Your AI agents ask. You decide.";
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
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", fontFamily: "sans-serif", background: "#181818" }}>
        <img src={src} width={1200} height={630} alt="" style={{ position: "absolute", inset: 0 }} />
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 260, display: "flex", background: "linear-gradient(to bottom, rgba(24,24,24,0), #181818)" }} />
        {/* The phone, in the gap. */}
        <div style={{ position: "absolute", left: 300, top: 70, width: 254, height: 540, borderRadius: 46, background: "#0b0b0b", border: "2px solid #3a3a3a", display: "flex", flexDirection: "column", alignItems: "center", padding: 10 }}>
          <div style={{ width: "100%", height: "100%", borderRadius: 38, background: "#161a18", display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 12 }}>
            <div style={{ width: 92, height: 26, borderRadius: 14, background: "#000", display: "flex" }} />
            <div style={{ marginTop: 34, fontSize: 56, color: TEXT, fontWeight: 300, display: "flex" }}>9:41</div>
            <div style={{ marginTop: 34, width: 214, borderRadius: 20, background: "rgba(60,60,60,0.85)", padding: 14, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 24, height: 24, borderRadius: 6, background: "#ede8de", display: "flex", alignItems: "center", justifyContent: "center" }}><Mark size={16} color="#131211" /></div>
                <div style={{ display: "flex", fontSize: 13, color: MUTED, letterSpacing: 2 }}>TEND</div>
                <div style={{ display: "flex", fontSize: 12, color: MUTED, marginLeft: "auto" }}>now</div>
              </div>
              <div style={{ display: "flex", fontSize: 15, fontWeight: 700, color: TEXT, lineHeight: 1.25 }}>ops-agent wants to pay invoice 2026-118</div>
              <div style={{ display: "flex", fontSize: 13, color: MUTED, lineHeight: 1.3 }}>4,800 EUR to Acme GmbH</div>
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <div style={{ flex: 1, height: 32, borderRadius: 10, background: GREEN, color: "#0e1813", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>Allow once</div>
                <div style={{ flex: 1, height: 32, borderRadius: 10, background: "rgba(255,255,255,0.14)", color: TEXT, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>Don’t allow</div>
              </div>
            </div>
          </div>
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
