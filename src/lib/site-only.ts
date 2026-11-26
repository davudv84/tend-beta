// Site-only mode (TEND_SITE_ONLY=1): a public showcase of the marketing website, for a separate deployment that has no database and no
// secrets. Only the marketing pages and their own static files are served; the dashboard, sign-in, admin, every API route and every other
// path answer 404, and the server never opens a database connection (src/server/db.ts getDb, src/server/http.ts route). The build refuses
// a site-only deployment that carries any database URL or TEND secret (src/server/deploy-check.mjs checkSiteOnly).
//
// Several layers, on purpose: the proxy (src/proxy.ts) answers 404 before any page or route runs; the app sections' layouts call notFound()
// (Next skips the proxy for router prefetches); the API wrapper and getDb refuse in case anything still reaches them.

export const siteOnly = () => process.env.TEND_SITE_ONLY === "1";

/** The marketing pages (src/app/(site) and the homepage), exactly or with sub-paths where the section has them. */
const PAGES = new Set(["/", "/about", "/changelog", "/compare", "/contact", "/docs", "/how-it-works", "/imprint", "/privacy", "/product", "/security", "/terms",
  "/threat-model", "/verification-report", "/robots.txt", "/sitemap.xml", "/opengraph-image", "/icon.svg", "/favicon.ico"]);
const SECTIONS = ["/compare/", "/product/"];
/** The marketing pages' own images and video in public/ (note: /home alone is the dashboard; only files under it are images). */
const ASSET = /^\/(art|home|screens|demo)\/[A-Za-z0-9._/-]+\.(avif|webp|jpg|jpeg|png|svg|mp4|webm)$/;

/** The site's "Sign in" and "Create an account" buttons: on the showcase they lead to the contact page instead of a 404. */
export const SITE_ONLY_TO_CONTACT = new Set(["/operator", "/account/sign-in", "/account/sign-up"]);

/** Whether a path may be served in site-only mode. Everything else is answered 404. */
export function sitePathAllowed(pathname: string): boolean {
  if (pathname.includes("..") || pathname.includes("//")) return false;
  if (PAGES.has(pathname) || ASSET.test(pathname)) return true;
  if (pathname.startsWith("/opengraph-image")) return true; // the hashed image URL in the page's metadata
  return SECTIONS.some((s) => pathname.startsWith(s) && /^[a-z0-9-]+$/.test(pathname.slice(s.length)));
}
