import { cn } from "@/lib/utils";
import SCREENS from "./screens.json";

/**
 * Screenshots of the real TEND app (scripts/screens: the app running with a sample workspace, every request made through its real API and
 * decided in its real screens). build-screens.py writes each one as AVIF and WebP at every width it can be drawn at and lists them in
 * screens.json, which this reads. Nothing here is drawn by hand.
 */
export type ShotName = keyof typeof SCREENS;
const srcSet = (name: ShotName, ext: "avif" | "webp", dark = false) => SCREENS[name].widths.map((w) => `/screens/${name}${dark ? "-dark" : ""}-${w}.${ext} ${w}w`).join(", ");
/** The visitor's own setting picks the app's theme in every screenshot: its dark theme for dark, its light theme otherwise. */
const DARK = "(prefers-color-scheme: dark)";
const largest = (name: ShotName) => SCREENS[name].widths[SCREENS[name].widths.length - 1];

/** One screenshot as a responsive picture, in the app's light or dark theme to match the visitor, drawn at its own proportions (or
 *  covering its box with `cover`). */
export function ShotImage({ name, alt, sizes, eager, cover, className }: { name: ShotName; alt: string; sizes: string; eager?: boolean; cover?: boolean; className?: string }) {
  const s = SCREENS[name];
  return (
    <picture className="contents">
      <source type="image/avif" media={DARK} srcSet={srcSet(name, "avif", true)} sizes={sizes} />
      <source type="image/webp" media={DARK} srcSet={srcSet(name, "webp", true)} sizes={sizes} />
      <source type="image/avif" srcSet={srcSet(name, "avif")} sizes={sizes} />
      <source type="image/webp" srcSet={srcSet(name, "webp")} sizes={sizes} />
      <img
        src={`/screens/${name}-${largest(name)}.webp`}
        alt={alt}
        width={s.w}
        height={s.h}
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : undefined}
        decoding="async"
        draggable={false}
        className={cn("block h-auto w-full select-none", cover && "h-full object-cover object-left-top", className)}
      />
    </picture>
  );
}

/** A screenshot in a frame: the app's window on the dark page, with a hairline and a soft shadow. */
export function Shot({ name, alt, sizes, eager, className, frame = "window" }: { name: ShotName; alt: string; sizes: string; eager?: boolean; className?: string; frame?: "window" | "card" | "phone" }) {
  return (
    <div className={cn(
      "mk-shot overflow-hidden",
      frame === "phone" ? "rounded-[28px] border-[6px] border-[#1c1c1c] shadow-[0_24px_60px_-24px_rgb(0_0_0/0.9)]" : "rounded-xl border border-white/[0.1] shadow-[0_30px_80px_-30px_rgb(0_0_0/0.85)]",
      className,
    )}>
      <ShotImage name={name} alt={alt} sizes={sizes} eager={eager} />
    </div>
  );
}
