import type { MetadataRoute } from "next";
import { PRODUCTS } from "@/components/marketing/site-data";
import { config } from "@/server/config";

/** The public pages only (the app behind sign-in is never listed). Needs TEND_APP_URL, the address people open TEND at; without it, none. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = config.appUrl;
  if (!base) return [];
  const pages = ["/", "/how-it-works", "/docs", "/security", "/verification-report", "/about", "/contact", "/imprint", "/privacy", "/terms", ...PRODUCTS.map((p) => `/product/${p}`)];
  return pages.map((p) => ({ url: `${base}${p === "/" ? "" : p}` }));
}
