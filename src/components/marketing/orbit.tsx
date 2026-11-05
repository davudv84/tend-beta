"use client";

import { IntegrationLogo } from "@/components/integration-logo";
import type { Integration } from "@/lib/integrations-catalog";
import { cn } from "@/lib/utils";
import { LogoTile } from "./logo";

const RINGS = [
  { r: 116, duration: 150, offset: -90 },
  { r: 200, duration: 200, offset: -70 },
  { r: 284, duration: 260, offset: -100 },
];

/**
 * TEND in the centre, the verified integrations on the two inner rings, what comes next on the outer one at lower opacity.
 * The rings drift slowly (the icons turn back, so they stay upright); still under reduced motion. The icons are the app's own.
 */
export function Orbit({ verified, next, label, className }: { verified: Integration[]; next: Integration[]; label: string; className?: string }) {
  const rings = [verified.slice(0, 5), verified.slice(5), next];
  return (
    <div role="img" aria-label={label} className={cn("relative", className)}>
      <div aria-hidden className="absolute top-1/2 left-1/2 size-[600px] -translate-x-1/2 -translate-y-1/2 scale-[0.6] sm:scale-75 lg:scale-100">
        {RINGS.map(({ r }, i) => (
          <span key={i} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.14]" style={{ width: r * 2, height: r * 2 }} />
        ))}
        {rings.map((items, i) => <Ring key={i} items={items} dim={i === 2} {...RINGS[i]} />)}
        <LogoTile className="absolute top-1/2 left-1/2 size-16 -translate-x-1/2 -translate-y-1/2 rounded-2xl shadow-[0_20px_60px_-20px_rgb(0_0_0/0.9)]" />
      </div>
    </div>
  );
}

function Ring({ items, r, duration, offset, dim }: { items: Integration[]; r: number; duration: number; offset: number; dim?: boolean }) {
  const style = { ["--mk-orbit-duration" as string]: `${duration}s` };
  return (
    <div className="mk-orbit-ring absolute top-1/2 left-1/2 size-0" style={style}>
      {items.map((it, i) => {
        const a = (((360 / items.length) * i + offset) * Math.PI) / 180;
        return (
          <span key={it.id} className="absolute" style={{ left: Math.round(Math.cos(a) * r), top: Math.round(Math.sin(a) * r) }}>
            <span className={cn("mk-orbit-item mk-light block -translate-x-1/2 -translate-y-1/2", dim && "opacity-55")} style={style}>
              <IntegrationLogo entry={it} className="size-11 rounded-full shadow-[0_10px_30px_-10px_rgb(0_0_0/0.9)]" />
            </span>
          </span>
        );
      })}
    </div>
  );
}
