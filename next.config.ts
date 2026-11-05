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
        ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
      ],
    }];
  },
  poweredByHeader: false,
  // The homepage looks at request time which pictures exist under public/home (components/marketing/images.ts), so a hosted build carries them.
  outputFileTracingIncludes: { "/": ["./public/home/**"] },
  // The embedded database (local development and tests) ships its own WebAssembly; load it from node_modules.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
