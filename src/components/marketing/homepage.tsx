"use client";

import { Hero } from "./hero";
import { Closing, Everything, Governance, Platform, Stats } from "./home-sections";
import { SiteFrame } from "./site-frame";
import type { HomeImages } from "./types";

/**
 * The public homepage, built in the order of sim.ai's: the headline and the clickable app, what it works with, three facts, one
 * checkpoint for every agent (with a call to try), the swipeable strip of everything TEND has, what it controls and what it doesn't,
 * and the last word. Every word comes from the dictionary, so the language switch changes it in place. The site's look is scoped
 * under `.mk` (globals.css); an app screen inside it gets the app's dark tokens under `.mk .ui-next[data-theme="dark"]`.
 */
/** `demo`: the read-only demo account is set up, so the hero and the closing lead with "Try the live demo". */
export function Homepage({ accounts, demo, images, fontClass }: { accounts: boolean; demo: boolean; images: HomeImages; fontClass: string }) {
  return (
    <SiteFrame accounts={accounts} images={images} fontClass={fontClass}>
      <Hero accounts={accounts} demo={demo} />
      <Stats />
      <Platform />
      <Everything />
      <Governance />
      <Closing accounts={accounts} demo={demo} />
    </SiteFrame>
  );
}
