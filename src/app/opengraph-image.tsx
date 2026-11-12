import { ImageResponse } from "next/og";

// The shared-link card (WhatsApp, Slack, LinkedIn, X): what TEND does, in one line, and the path every tool call takes. Generated at build
// time from this file, so it stays in TEND's own colours and type; there is no image file to keep in sync.
export const alt = "TEND: your AI agent asks, TEND decides. Allow, block or approve every tool call from Claude Code before it runs.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#0d1311", PANEL = "#141c19", LINE = "#24312c", TEXT = "#f2f5f3", MUTED = "#93a69e", ACCENT = "#8dbba5";

function Mark({ size: s }: { size: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <path d="M19 4.5H5.5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1H19" stroke={ACCENT} strokeWidth="2" strokeLinecap="square" />
      <rect x="9" y="9" width="6" height="6" fill={ACCENT} />
      <path d="M15 12h7" stroke={ACCENT} strokeWidth="2" />
    </svg>
  );
}

const Step = ({ name, note, accent }: { name: string; note: string; accent?: boolean }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "18px 22px", borderRadius: 14, width: 220, background: accent ? "rgba(141,187,165,0.12)" : PANEL, border: `1px solid ${accent ? "rgba(141,187,165,0.45)" : LINE}` }}>
    <div style={{ display: "flex", fontSize: 24, fontWeight: 700, color: accent ? ACCENT : TEXT, letterSpacing: accent ? 3 : 0 }}>{name}</div>
    <div style={{ display: "flex", fontSize: 18, color: MUTED }}>{note}</div>
  </div>
);
const Arrow = () => <div style={{ display: "flex", fontSize: 26, color: "#4a5d55", margin: "0 14px" }}>→</div>;

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: INK, padding: "64px 72px", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <Mark size={44} />
            <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: TEXT, letterSpacing: 6 }}>TEND</div>
          </div>
          <div style={{ display: "flex", fontSize: 20, color: ACCENT, border: `1px solid rgba(141,187,165,0.4)`, borderRadius: 999, padding: "8px 18px" }}>Private beta</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 72, fontWeight: 700, color: TEXT, lineHeight: 1.05, letterSpacing: -2 }}>
            <div style={{ display: "flex" }}>Your AI agent asks.</div>
            <div style={{ display: "flex", color: ACCENT }}>TEND decides.</div>
          </div>
          <div style={{ display: "flex", fontSize: 28, color: MUTED, maxWidth: 900, lineHeight: 1.4 }}>Allow, block or approve every tool call from Claude Code before it runs. Every decision on record.</div>
        </div>
        <div style={{ display: "flex", alignItems: "center" }}>
          <Step name="Agent" note="asks to use a tool" />
          <Arrow />
          <Step name="TEND" note="checks the request" accent />
          <Arrow />
          <Step name="Policy" note="allow · ask · deny" />
          <Arrow />
          <Step name="Tool" note="runs only on a yes" />
        </div>
      </div>
    ),
    { ...size },
  );
}
