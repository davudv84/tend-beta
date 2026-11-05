"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A browser window holding one of TEND's screens, rendered at a fixed width and scaled to fit, so it stays crisp at any size and
 * the screen's layout does not change with the window. The screen is decorative here: hidden from assistive technology and
 * inert, with `label` as its text alternative. Before JavaScript runs, the browser's own container arithmetic sets the scale
 * where it can; afterwards a measurement does.
 */
export function ScreenFrame({ children, label, width = 1040, height = 720, className, address }: { children: React.ReactNode; label: string; width?: number; height?: number; className?: string; address?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return (
    <div role="img" aria-label={label} className={cn("overflow-hidden rounded-2xl border border-white/10 bg-[#f5f5f5] shadow-[0_40px_120px_-30px_rgb(0_0_0/0.8)]", className)}>
      <div aria-hidden className="flex h-9 items-center gap-2 border-b border-black/[0.06] bg-[#ececea] px-3">
        <span className="size-2.5 rounded-full bg-[#d9d9d5]" /><span className="size-2.5 rounded-full bg-[#d9d9d5]" /><span className="size-2.5 rounded-full bg-[#d9d9d5]" />
        {address && <span className="ml-3 flex h-6 min-w-40 items-center rounded-md bg-white px-2.5 text-[11px] text-[#737373]">{address}</span>}
      </div>
      <div ref={ref} className="relative w-full [container-type:inline-size]" style={{ aspectRatio: `${width} / ${height}`, ["--mk-screen-w" as string]: `${width}px` }}>
        <div
          aria-hidden
          inert
          className="absolute top-0 left-0 origin-top-left [transform:scale(var(--mk-scale,1))]"
          style={{ width, height, ["--mk-scale" as string]: "calc(100cqw / var(--mk-screen-w))", ...(scale ? { transform: `scale(${scale})` } : {}) }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
