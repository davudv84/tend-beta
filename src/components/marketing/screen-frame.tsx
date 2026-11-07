"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A dark browser window holding one of TEND's screens, the whole window and nothing cropped. The screen is laid out at a fixed
 * width and zoomed to fit, so its layout does not change with the window, and the browser draws its text and hairlines at their
 * final size, sharp at any width (a transform would only scale a picture of them). The screen is decorative here: hidden from
 * assistive technology and inert, with `label` as its text alternative. Before JavaScript runs, the browser's own container
 * arithmetic sets the zoom where it can; afterwards a measurement does.
 */
export function ScreenFrame({ children, label, width = 1280, height = 800, className, address }: { children: React.ReactNode; label: string; width?: number; height?: number; className?: string; address?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setZoom(entry.contentRect.width / width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return (
    <div role="img" aria-label={label} className={cn("overflow-hidden rounded-2xl border border-white/[0.12] bg-[#131211] shadow-[0_50px_140px_-40px_rgb(0_0_0/0.9),0_0_0_1px_rgb(0_0_0/0.6)]", className)}>
      <div aria-hidden className="grid h-7 grid-cols-[1fr_auto_1fr] items-center border-b border-white/[0.07] bg-[#1b1a18] px-2.5 sm:h-10 sm:px-4">
        <span className="flex gap-1.5 sm:gap-2"><span className="size-2 rounded-full bg-white/[0.13] sm:size-3" /><span className="size-2 rounded-full bg-white/[0.13] sm:size-3" /><span className="size-2 rounded-full bg-white/[0.13] sm:size-3" /></span>
        {address ? <span className="flex h-[18px] items-center justify-center rounded-md bg-white/[0.05] px-2.5 text-[10px] text-[#a9a296] sm:h-6 sm:min-w-56 sm:px-3 sm:text-[11.5px]">{address}</span> : <span />}
        <span />
      </div>
      <div ref={ref} className="relative w-full [container-type:inline-size]" style={{ aspectRatio: `${width} / ${height}`, ["--mk-screen-w" as string]: `${width}px` }}>
        <div
          aria-hidden
          inert
          className="absolute top-0 left-0 overflow-hidden [zoom:var(--mk-zoom,1)]"
          style={{ width, height, ["--mk-zoom" as string]: "calc(100cqw / var(--mk-screen-w))", ...(zoom ? { zoom } : {}) }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
