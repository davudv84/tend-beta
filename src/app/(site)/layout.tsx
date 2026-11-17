import type { Viewport } from "next";
import { newsreader } from "@/components/marketing/fonts";
import { homeImages } from "@/components/marketing/images";
import { SiteFrame } from "@/components/marketing/site-frame";
import { config } from "@/server/config";

/** The browser's own bars take the site's colour on a phone, and the page is dark from the first frame. */
export const viewport: Viewport = { themeColor: "#181818", colorScheme: "dark", viewportFit: "cover" };

/** The public site's pages besides the homepage (How it works, Security, Docs, the legal pages…): the homepage's header, footer and look. */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <SiteFrame accounts={config.accounts} images={homeImages()} fontClass={newsreader.variable}>{children}</SiteFrame>;
}
