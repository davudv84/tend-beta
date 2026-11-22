"use client";

import { Passage } from "./home/passage";
import { Closing, Control, ProductView, Start, Why, Works } from "./home/sections";
import { SiteFrame } from "./site-frame";
import type { HomeImages } from "./types";

/**
 * The public homepage, one idea per section: the hero and TEND in four steps (a scroll-driven 3D scene of real screens); why it exists;
 * what you control; the moment that matters in the real app; how to start; what it works with; and the last word.
 * Every word comes from the dictionary, so the language switch changes it in place. The site's look is scoped under `.mk`
 * (globals.css); an app screen inside it gets the app's dark tokens under `.mk .ui-next[data-theme="dark"]`.
 */
/** `demo`: the read-only demo account is set up, so the hero and the closing lead with "Try the live demo". */
export function Homepage({ accounts, demo, images, fontClass }: { accounts: boolean; demo: boolean; images: HomeImages; fontClass: string }) {
  return (
    <SiteFrame accounts={accounts} images={images} fontClass={fontClass}>
      <Passage accounts={accounts} demo={demo} />
      <Why />
      <Control />
      <ProductView />
      <Start accounts={accounts} demo={demo} />
      <Works />
      <Closing accounts={accounts} demo={demo} />
    </SiteFrame>
  );
}
