"use client";

import Image from "next/image";
import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * Dusk over forested hills: the picture when it exists under public/home, otherwise hills drawn in the same mood, so the page
 * looks finished before the pictures arrive. `preload` marks the one picture that is the largest thing above the fold.
 */
export function Landscape({ src, alt = "", preload, className, position = "center", tone = "dusk", mask }: {
  src?: string; alt?: string; preload?: boolean; className?: string; position?: string; tone?: "dusk" | "night"; mask?: string;
}) {
  return (
    <div aria-hidden={alt ? undefined : true} className={cn("absolute inset-0 overflow-hidden", className)} style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}>
      {src ? <Image src={src} alt={alt} fill sizes="100vw" preload={preload} className="object-cover" style={{ objectPosition: position }} /> : <Hills tone={tone} />}
    </div>
  );
}

/** Four ridges under a dusk or night sky. Decorative only. */
export function Hills({ tone = "dusk", className }: { tone?: "dusk" | "night"; className?: string }) {
  const id = useId();
  const sky = `${id}-sky`, glow = `${id}-glow`;
  return (
    <svg aria-hidden viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" className={cn("h-full w-full", className)}>
      <defs>
        <linearGradient id={sky} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#050605" />
          <stop offset="0.5" stopColor={tone === "dusk" ? "#0b1b19" : "#07120e"} />
          <stop offset="1" stopColor={tone === "dusk" ? "#3b2718" : "#0e2219"} />
        </linearGradient>
        <radialGradient id={glow} cx="0.38" cy="0.66" r="0.45">
          <stop offset="0" stopColor="#d4753f" stopOpacity={tone === "dusk" ? 0.6 : 0} />
          <stop offset="1" stopColor="#d4753f" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="1600" height="900" fill={`url(#${sky})`} />
      <rect width="1600" height="900" fill={`url(#${glow})`} />
      <path d="M0 585 C 180 535, 360 575, 540 548 S 880 490, 1090 528 S 1440 572, 1600 528 V900 H0Z" fill="#14302a" />
      <path d="M0 655 C 240 605, 430 660, 650 628 S 1010 578, 1260 622 S 1500 662, 1600 632 V900 H0Z" fill="#0e2119" />
      <path d="M0 735 C 300 705, 520 752, 780 712 S 1160 672, 1410 724 S 1560 744, 1600 736 V900 H0Z" fill="#09160f" />
      <path d="M0 815 C 260 793, 560 833, 840 803 S 1310 783, 1600 813 V900 H0Z" fill="#06100b" />
    </svg>
  );
}

/** Leafy silhouettes along the bottom edge, for the hero when there is no cut-out foreground picture yet. */
export function Bushes({ className }: { className?: string }) {
  const blobs = [
    [40, 860, 170], [230, 890, 140], [420, 850, 190], [640, 900, 150], [820, 870, 175], [1010, 905, 130], [1180, 860, 185], [1390, 895, 150], [1560, 870, 170],
    [120, 800, 110], [540, 790, 100], [930, 810, 115], [1300, 800, 105],
  ];
  return (
    <svg aria-hidden viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" className={cn("h-full w-full", className)}>
      {blobs.map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill={i < 9 ? "#07110c" : "#0a1811"} />)}
      <rect y="880" width="1600" height="20" fill="#050605" />
    </svg>
  );
}
