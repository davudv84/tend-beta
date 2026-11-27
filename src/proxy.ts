import { NextResponse } from "next/server.js";
import type { NextRequest } from "next/server.js";
import { buildCsp, cspMode, newNonce } from "./lib/csp.ts";
import { SITE_ONLY_TO_CONTACT, siteOnly, sitePathAllowed } from "./lib/site-only.ts";

/**
 * Adds a per-request nonce and the Content-Security-Policy to every page (Next 16 "proxy", formerly middleware). Next reads the nonce from the
 * REQUEST's policy header and stamps it on its own scripts and styles while rendering; the browser enforces the policy from the RESPONSE header.
 * API routes get no page policy (they return JSON and carry their own, from next.config.ts); static files are skipped.
 */
export function proxy(request: NextRequest) {
  // Trailing slashes are redirected here instead of by Next (skipTrailingSlashRedirect in next.config.ts), so the redirect carries a
  // Content-Type and the same headers as every other answer. Same origin only: the URL is this request's, with its path trimmed.
  const { pathname } = request.nextUrl;
  if (pathname.length > 1 && pathname.endsWith("/")) {
    // From the raw request URL: Next's nextUrl keeps the trailing slash it was given, which would redirect to itself.
    const to = new URL(request.url);
    to.pathname = to.pathname.replace(/\/+$/, "") || "/";
    return new NextResponse(null, { status: 308, headers: { location: to.toString(), "content-type": "text/plain; charset=utf-8" } });
  }
  // Site-only showcase (src/lib/site-only.ts): nothing but the marketing pages and their files; no API, no dashboard, no sign-in.
  if (siteOnly() && SITE_ONLY_TO_CONTACT.has(pathname)) {
    const to = new URL(request.url); to.pathname = "/contact"; to.search = "";
    return new NextResponse(null, { status: 307, headers: { location: to.toString(), "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }
  if (siteOnly() && !sitePathAllowed(pathname))
    return new NextResponse("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
  if (pathname === "/api" || pathname.startsWith("/api/")) return NextResponse.next(); // JSON: its own strict policy (next.config.ts)
  const mode = cspMode();
  if (mode === "off") return NextResponse.next();
  const policy = buildCsp({ nonce: newNonce(), dev: process.env.NODE_ENV === "development" });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", policy); // Next extracts the nonce from here
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(mode === "report" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|icon.svg|opengraph-image).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
