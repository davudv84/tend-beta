"use client";

import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { Cta } from "./cta";
import { Features } from "./features";
import { Footer } from "./footer";
import { Hero } from "./hero";
import { Honest } from "./honest";
import { Integrations } from "./integrations";
import { Nav } from "./nav";
import { Why } from "./why";
import type { HomeImages } from "./types";

/**
 * The public homepage: a black site, with TEND's own screens shown in white inside it. Every word comes from the dictionary, so the
 * language switch changes it in place. The page's own dark look is scoped under `.mk` (globals.css); an embedded app screen gets
 * the app's light tokens back under `.mk .ui-next`, so it renders as the app does.
 */
export function Homepage({ accounts, images, fontClass }: { accounts: boolean; images: HomeImages; fontClass: string }) {
  const t = useT();
  return (
    <div className={cn("mk min-h-dvh font-sans", fontClass)}>
      <a href="#main" className="sr-only z-50 focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:rounded-full focus:bg-white focus:px-4 focus:py-2 focus:text-[14px] focus:text-[#171717]">{t.front.skip}</a>
      <Nav accounts={accounts} />
      <main id="main">
        <Hero accounts={accounts} images={images} />
        <Why />
        <Features images={images} />
        <Integrations images={images} />
        <Honest />
        <Cta accounts={accounts} />
      </main>
      <Footer accounts={accounts} images={images} />
    </div>
  );
}
