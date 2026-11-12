import { preload as preloadResource } from "react-dom";
import { cn } from "@/lib/utils";
import ART from "./art-sizes.json";

/**
 * The painting behind the hero and the closing: a misty valley at dusk, darkened 40% at export. scripts/art/build-art.py writes every
 * width it can be drawn at (1x and 2x, AVIF q70 and WebP q85) and lists them in art-sizes.json, which this reads.
 *
 * - Hero: below 1024px a tall crop around the bright gap and the river fills the whole hero (the phone stands in the gap). From
 *   1024px the whole valley is drawn at its own proportions across the top, so it is drawn at the window's width and never scaled up
 *   past what the files hold; it fades into the page under the app window.
 * - Sky: the sky only, for the closing.
 *
 * Art direction needs <picture>, which next/image doesn't do; the files are already the sizes and formats it would make.
 */
type ArtSet = keyof typeof ART;
const srcSet = (set: ArtSet, ext: "avif" | "webp") => ART[set].widths.map((w) => `/art/${set}-${w}.${ext} ${w}w`).join(", ");
const largest = (set: ArtSet) => ART[set].widths[ART[set].widths.length - 1];
const middle = (set: ArtSet) => ART[set].widths[Math.floor((ART[set].widths.length - 1) / 2)];

/** On a phone the tall crop is drawn about 1.6 times the screen's width (it fills the hero's height); on a tablet, at its width. */
const TALL_SIZES = "(max-width: 767px) 165vw, 100vw";
const NARROW = "(max-width: 1023px)";

export function HeroPainting({ alt }: { alt: string }) {
  // Start the painting with the page itself, as AVIF, in the crop this screen will use.
  preloadResource(`/art/valley-tall-${middle("valley-tall")}.avif`, { as: "image", imageSrcSet: srcSet("valley-tall", "avif"), imageSizes: TALL_SIZES, media: NARROW, type: "image/avif", fetchPriority: "high" });
  preloadResource(`/art/valley-${middle("valley")}.avif`, { as: "image", imageSrcSet: srcSet("valley", "avif"), imageSizes: "100vw", media: "(min-width: 1024px)", type: "image/avif", fetchPriority: "high" });
  return (
    <div className="absolute inset-x-0 top-0 -z-20 h-full lg:h-auto">
      <picture className="block h-full w-full lg:h-auto">
        <source media={NARROW} type="image/avif" srcSet={srcSet("valley-tall", "avif")} sizes={TALL_SIZES} />
        <source media={NARROW} type="image/webp" srcSet={srcSet("valley-tall", "webp")} sizes={TALL_SIZES} />
        <source type="image/avif" srcSet={srcSet("valley", "avif")} sizes="100vw" />
        <source type="image/webp" srcSet={srcSet("valley", "webp")} sizes="100vw" />
        <img
          src={`/art/valley-${middle("valley")}.webp`}
          alt={alt}
          width={largest("valley")}
          height={Math.round(largest("valley") / ART.valley.aspect)}
          fetchPriority="high"
          loading="eager"
          className="h-full w-full object-cover object-[50%_42%] lg:h-auto"
        />
      </picture>
      {/* A soft edge under the header, and the bottom third fading to the page. */}
      <div aria-hidden className="absolute inset-0 bg-[linear-gradient(to_bottom,#181818_0%,rgb(24_24_24/0)_14%,rgb(24_24_24/0)_62%,#181818_100%)]" />
    </div>
  );
}

/** The sky, behind the closing: drawn at the window's width. */
export function SkyPainting({ alt, className }: { alt: string; className?: string }) {
  return (
    <picture className={cn("absolute inset-0 block overflow-hidden", className)}>
      <source type="image/avif" srcSet={srcSet("sky", "avif")} sizes="100vw" />
      <source type="image/webp" srcSet={srcSet("sky", "webp")} sizes="100vw" />
      <img src={`/art/sky-${middle("sky")}.webp`} alt={alt} width={largest("sky")} height={Math.round(largest("sky") / ART.sky.aspect)} loading="lazy" decoding="async" className="h-full w-full object-cover object-[50%_40%]" />
    </picture>
  );
}
