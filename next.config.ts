import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // The Sanctuary replaced the original overview.
  async redirects() {
    return [{ source: "/overview", destination: "/sanctuary", permanent: false }];
  },
  // The Content-Security-Policy (with its per-request nonce) is set by src/proxy.ts. These are the static ones.
  // Strict-Transport-Security is only meaningful, and only honoured by browsers, over https; it is sent in production builds so a hosted instance
  // is https-only after the first visit. (Plain-http local servers ignore it by the browser's own rule.)
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "same-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        // Everything TEND loads is its own (or data:/blob:), so cross-origin isolation costs nothing and keeps other sites from embedding
        // its responses: COEP for what pages load, CORP for who may load TEND's responses.
        { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
      ],
    }, {
      // The API returns JSON, never a document: its own policy allows nothing at all (the page policy with its nonce comes from src/proxy.ts),
      // also on errors and on paths that do not exist. Never cached: answers depend on who asks.
      source: "/api/:path*",
      headers: [
        { key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; sandbox" },
        { key: "Cache-Control", value: "no-store" },
      ],
    }, {
      source: "/api",
      headers: [
        { key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; sandbox" },
        { key: "Cache-Control", value: "no-store" },
      ],
    }];
  },
  poweredByHeader: false,
  // src/proxy.ts redirects trailing slashes itself, with a Content-Type (Next's own 308 has none).
  skipTrailingSlashRedirect: true,
  // The stylesheet is a separate same-origin file, not inlined: Next does not put the CSP nonce on an inlined stylesheet, and the policy no
  // longer allows inline style elements (src/lib/csp.ts). One more request on the first visit, cached afterwards.
  // Any picture served through next/image goes out as AVIF where the browser takes it, WebP otherwise.
  images: { formats: ["image/avif", "image/webp"] },
  // The homepage looks at request time which pictures exist under public/home (components/marketing/images.ts), so a hosted build carries them.
  outputFileTracingIncludes: { "/": ["./public/home/**"] },
  // The embedded database (local development and tests) ships its own WebAssembly; load it from node_modules.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
