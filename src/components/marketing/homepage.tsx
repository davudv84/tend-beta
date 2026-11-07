"use client";

import { Cta } from "./cta";
import { Features } from "./features";
import { Hero } from "./hero";
import { Honest } from "./honest";
import { Integrations } from "./integrations";
import { SiteFrame } from "./site-frame";
import { Why } from "./why";
import type { HomeImages } from "./types";

/**
 * The public homepage: a black site, with TEND's own screens shown whole inside it, in the app's dark theme. Every word comes from the
 * dictionary, so the language switch changes it in place. The page's own dark look is scoped under `.mk` (globals.css); an embedded
 * app screen gets the app's dark tokens under `.mk .ui-next[data-theme="dark"]`, so it renders as the app does in dark.
 */
export function Homepage({ accounts, images, fontClass }: { accounts: boolean; images: HomeImages; fontClass: string }) {
  return (
    <SiteFrame accounts={accounts} images={images} fontClass={fontClass}>
      <Hero accounts={accounts} images={images} />
      <Why />
      <Features images={images} />
      <Integrations images={images} />
      <Honest />
      <Cta accounts={accounts} />
    </SiteFrame>
  );
}
