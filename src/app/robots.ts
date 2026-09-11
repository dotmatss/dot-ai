import type { MetadataRoute } from "next";

import { getServerEnv } from "@/config/env";

/**
 * Crawlers get the public surface only. The application itself is behind
 * authentication and the embed route is meant to be framed, not indexed.
 */
export default function robots(): MetadataRoute.Robots {
  const origin = getServerEnv().APP_URL.replace(/\/$/, "");
  return {
    rules: [{ userAgent: "*", allow: ["/", "/pricing", "/docs", "/terms", "/privacy", "/cookies"], disallow: ["/w/", "/api/", "/embed/", "/sign-in", "/sign-up", "/onboarding"] }],
    sitemap: `${origin}/sitemap.xml`,
  };
}
