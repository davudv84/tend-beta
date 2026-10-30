import { NextResponse } from "next/server.js";
import type { NextRequest } from "next/server.js";
import { buildCsp, cspMode, newNonce } from "./lib/csp.ts";

/**
 * Adds a per-request nonce and the Content-Security-Policy to every page (Next 16 "proxy", formerly middleware). Next reads the nonce from the
 * REQUEST's policy header and stamps it on its own scripts and styles while rendering; the browser enforces the policy from the RESPONSE header.
 * API routes and static files are skipped: they return JSON or assets, never a document.
 */
export function proxy(request: NextRequest) {
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
      source: "/((?!api|_next/static|_next/image|favicon.ico|icon.svg|opengraph-image).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
