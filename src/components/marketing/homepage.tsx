"use client";

import { Passage } from "./home/passage";
import { Closing, Developers, HowItWorks, Problem, ProductTour, Trust, UseCases } from "./home/sections";
import { SiteFrame } from "./site-frame";
import type { HomeImages } from "./types";

/**
 * The public homepage. It opens with one request followed through TEND in 3D (home/passage.tsx), ending on the real approval screen,
 * and continues: why agents need a checkpoint, how TEND works, the product, where it matters, the code, what it does and doesn't do,
 * and the last word. Every word comes from the dictionary (`land`), so the language switch changes it in place. The page is the
 * site's `.mk` scope, darker (`.mk-home`, globals.css).
 */
/** `demo`: the read-only demo account is set up, so the hero and the closing lead with "Try the live demo". */
export function Homepage({ accounts, demo, images, fontClass }: { accounts: boolean; demo: boolean; images: HomeImages; fontClass: string }) {
  return (
    <SiteFrame accounts={accounts} images={images} fontClass={fontClass} className="mk-home">
      <Passage accounts={accounts} demo={demo} />
      <Problem />
      <HowItWorks />
      <ProductTour />
      <UseCases />
      <Developers />
      <Trust />
      <Closing accounts={accounts} demo={demo} />
    </SiteFrame>
  );
}
