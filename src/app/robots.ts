import type { MetadataRoute } from "next";
import { config } from "@/server/config";

/** Search engines may read the public site; the app, its API and the account screens are left out (they need a sign-in anyway). */
export default function robots(): MetadataRoute.Robots {
  const app = ["/api/", "/account/", "/home", "/agents", "/oversight", "/timeline", "/policies", "/verification", "/settings", "/connect", "/integrations",
    "/developers", "/labs", "/admin", "/operator", "/check-ins", "/reflections", "/research", "/sanctuary", "/welcome", "/prototype"];
  return { rules: { userAgent: "*", allow: "/", disallow: app }, ...(config.appUrl && { sitemap: `${config.appUrl}/sitemap.xml` }) };
}
