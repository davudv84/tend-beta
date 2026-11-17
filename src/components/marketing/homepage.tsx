"use client";

import { Hero } from "./hero";
import { Closing, Everything, Holds, Proof, TryIt } from "./home-sections";
import { SiteFrame } from "./site-frame";
import type { HomeImages } from "./types";

/**
 * The public homepage, in TEND's own order: the line and the phone with its approval notification; proof (what it works with and
 * three counted facts); one tool call to try; everything around the approval, each screen once; how it holds, for engineers; and the
 * last word. Every word comes from the dictionary, so the language switch changes it in place. The site's look is scoped under `.mk`
 * (globals.css); an app screen inside it gets the app's dark tokens under `.mk .ui-next[data-theme="dark"]`.
 */
/** `demo`: the read-only demo account is set up, so the hero and the closing lead with "Try the live demo". */
export function Homepage({ accounts, demo, images, fontClass }: { accounts: boolean; demo: boolean; images: HomeImages; fontClass: string }) {
  return (
    <SiteFrame accounts={accounts} images={images} fontClass={fontClass}>
      <Hero accounts={accounts} demo={demo} />
      <Proof />
      <TryIt />
      <Everything />
      <Holds />
      <Closing accounts={accounts} demo={demo} />
    </SiteFrame>
  );
}
