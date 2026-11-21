/**
 * The room behind the hero: near-black charcoal with one architectural idea taken from the TEND mark, a gateway.
 * Two piers and a lintel stand as hairlines in the dark, the opening is lit softly from above. Everything is CSS and one static SVG grain: no image to download, no motion,
 * nothing that repaints on scroll. It is purely decorative and stays well below the headline's contrast needs.
 *
 * It paints on the page's own #181818 (the .mk background) and fades back into it at the bottom, where the app window starts.
 */
const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .55 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

/** One frame of the gateway: piers and a lintel, hairline-thin, fading out toward the bottom like a structure standing in haze. */
function Frame({ className, tone }: { className: string; tone: string }) {
  return (
    <div
      aria-hidden
      className={`absolute inset-y-0 left-1/2 -translate-x-1/2 [mask-image:linear-gradient(to_bottom,#000_0%,#000_38%,transparent_88%)] ${className}`}
    >
      {/* piers: lit on their inner face, dark on the outer */}
      <div className="absolute inset-y-0 left-0 w-px" style={{ background: tone }} />
      <div className="absolute inset-y-0 right-0 w-px" style={{ background: tone }} />
      <div className="absolute inset-y-0 left-0 w-[6%] bg-[linear-gradient(to_right,rgb(255_255_255/0.035),transparent)]" />
      <div className="absolute inset-y-0 right-0 w-[6%] bg-[linear-gradient(to_left,rgb(255_255_255/0.035),transparent)]" />
      {/* lintel */}
      <div className="absolute inset-x-0 top-0 h-px" style={{ background: tone }} />
    </div>
  );
}

/** `className` replaces the default `-z-20`, for use inside a stacking context (the passage's hero and picture layer). */
export function HeroBackdrop({ className = "-z-20" }: { className?: string }) {
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      {/* Controlled light: one soft wash from above, centred on the opening, narrower than the text column's surroundings. */}
      <div className="absolute inset-x-0 top-0 h-[78%] bg-[radial-gradient(ellipse_52%_70%_at_50%_0%,rgb(255_255_255/0.085),rgb(255_255_255/0.025)_48%,transparent_78%)]" />
      {/* Floor of the room: a faint cool-warm lift where the opening meets the app window. */}
      <div className="absolute inset-x-0 bottom-[8%] h-[34%] bg-[radial-gradient(ellipse_60%_100%_at_50%_100%,rgb(95_184_146/0.05),transparent_70%)]" />

      {/* The gateway: one frame, wider than the text column so the headline stands inside the opening. */}
      <Frame className="w-[min(1180px,calc(100%-24px))]" tone="rgb(255 255 255 / 0.09)" />

      {/* Vignette: pulls the corners down so the centre reads as lit. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_90%_80%_at_50%_30%,transparent_55%,rgb(0_0_0/0.35)_100%)]" />

      {/* Fine grain, static. Overlay keeps it a texture, not a tint. */}
      <div className="absolute inset-0 opacity-[0.06] mix-blend-overlay" style={{ backgroundImage: GRAIN, backgroundSize: "160px 160px" }} />

      {/* A soft edge under the header, and the bottom third returning to the page colour (as the painting did). */}
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,#181818_0%,rgb(24_24_24/0)_10%,rgb(24_24_24/0)_62%,#181818_100%)]" />
    </div>
  );
}
