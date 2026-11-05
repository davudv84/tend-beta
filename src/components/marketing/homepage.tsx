"use client";

import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { useDocumentTheme } from "@/ui/theme";
import { Nav } from "./nav";
import type { HomeImages } from "./types";

/**
 * The public homepage: a black site, with TEND's own screens shown in white inside it. Every word comes from the dictionary, so the
 * language switch changes it in place. The document theme is set to light while this page is shown so the embedded app screens
 * render exactly as the app does; the page's own dark look is scoped under `.mk` (globals.css).
 */
export function Homepage({ accounts, images, fontClass }: { accounts: boolean; images: HomeImages; fontClass: string }) {
  const t = useT();
  useDocumentTheme("light");
  void images;
  return (
    <div className={cn("mk min-h-dvh font-sans", fontClass)}>
      <a href="#main" className="sr-only z-50 focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:rounded-full focus:bg-white focus:px-4 focus:py-2 focus:text-[14px] focus:text-[#171717]">{t.front.skip}</a>
      <Nav accounts={accounts} />
      <main id="main">{/* The sections follow, one commit each. */}</main>
    </div>
  );
}
