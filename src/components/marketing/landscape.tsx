import { preload as preloadResource } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * The painting behind the hero and the closing: a misty valley at dusk, darkened about 40% at export (public/art, AVIF and WebP in
 * the sizes it is drawn at). The hero gets the whole valley cropped so the bright gap is the exact centre, and on a phone a tall crop
 * around the gap and the river; the closing gets the sky only. Art direction needs <picture>, which next/image doesn't do, and the
 * files are already the sizes and formats it would make.
 */
const SETS = {
  valley: {
    wide: { sizes: [828, 1280, 1810], file: "valley" },
    tall: { sizes: [480, 960], file: "valley-tall" },
  },
  sky: {
    wide: { sizes: [720, 1440], file: "sky" },
    tall: { sizes: [720, 1440], file: "sky" },
  },
} as const;

const srcSet = (file: string, sizes: readonly number[], ext: "avif" | "webp") => sizes.map((w) => `/art/${file}-${w}.${ext} ${w}w`).join(", ");

export function Painting({ art, alt, preload, className, position = "50% 50%" }: { art: keyof typeof SETS; alt: string; preload?: boolean; className?: string; position?: string }) {
  const { wide, tall } = SETS[art];
  if (preload) {
    // Start the hero painting with the page itself, the phone crop on a phone and the wide one elsewhere, as AVIF.
    preloadResource(`/art/${tall.file}-${tall.sizes[0]}.webp`, { as: "image", imageSrcSet: srcSet(tall.file, tall.sizes, "webp"), imageSizes: "100vw", media: "(max-width: 767px)", type: "image/webp", fetchPriority: "high" });
    preloadResource(`/art/${wide.file}-${wide.sizes[1]}.avif`, { as: "image", imageSrcSet: srcSet(wide.file, wide.sizes, "avif"), imageSizes: "100vw", media: "(min-width: 768px)", type: "image/avif", fetchPriority: "high" });
  }
  return (
    <picture className={cn("absolute inset-0 block overflow-hidden", className)}>
      <source media="(max-width: 767px)" type="image/webp" srcSet={srcSet(tall.file, tall.sizes, "webp")} sizes="100vw" />
      <source type="image/avif" srcSet={srcSet(wide.file, wide.sizes, "avif")} sizes="100vw" />
      <source type="image/webp" srcSet={srcSet(wide.file, wide.sizes, "webp")} sizes="100vw" />
      <img
        src={`/art/${wide.file}-${wide.sizes[1]}.webp`}
        alt={alt}
        width={wide.sizes[wide.sizes.length - 1]}
        height={art === "valley" ? 822 : 500}
        fetchPriority={preload ? "high" : undefined}
        loading={preload ? "eager" : "lazy"}
        decoding={preload ? undefined : "async"}
        className="h-full w-full object-cover"
        style={{ objectPosition: position }}
      />
    </picture>
  );
}
