import { newsreader } from "@/components/marketing/fonts";
import { homeImages } from "@/components/marketing/images";
import { SiteFrame } from "@/components/marketing/site-frame";
import { config } from "@/server/config";

/** The public site's pages besides the homepage (How it works, Security, Docs, the legal pages…): the homepage's header, footer and look. */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <SiteFrame accounts={config.accounts} images={homeImages()} fontClass={newsreader.variable}>{children}</SiteFrame>;
}
