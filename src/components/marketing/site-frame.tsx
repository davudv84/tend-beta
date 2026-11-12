"use client";

import { LazyMotion } from "framer-motion";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { Footer } from "./footer";
import { Nav } from "./nav";
import type { HomeImages } from "./types";

const loadFeatures = () => import("./motion-features").then((r) => r.default);

/**
 * The public site's frame: the black `.mk` scope (globals.css), the skip link, the header and the footer around a page. The homepage and
 * every page linked from it (How it works, Security, Docs, the legal pages…) use it, so all of them look and navigate the same.
 */
export function SiteFrame({ accounts, images, fontClass, children }: { accounts: boolean; images: HomeImages; fontClass: string; children: React.ReactNode }) {
  const t = useT();
  return (
    <div className={cn("mk mk-safe min-h-dvh overflow-x-clip font-sans", fontClass)}>
      <a href="#main" className="sr-only z-50 focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:rounded-full focus:bg-white focus:px-4 focus:py-2 focus:text-[14px] focus:text-[#171717]">{t.front.skip}</a>
      <Nav accounts={accounts} />
      {/* The site animates with framer-motion's light `m` components; their features arrive in a chunk of their own after the page. */}
      <LazyMotion features={loadFeatures} strict>
        <main id="main">{children}</main>
      </LazyMotion>
      <Footer accounts={accounts} images={images} />
    </div>
  );
}
