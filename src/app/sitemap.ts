import type { MetadataRoute } from "next";

import { getServerEnv } from "@/config/env";
import { DOC_PAGES } from "@/features/docs/registry";
import { LEGAL_DOCUMENTS } from "@/features/legal/registry";

/** The public surface: the landing page, the documentation and the legal pages. */
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = getServerEnv().APP_URL.replace(/\/$/, "");

  return [
    { url: `${origin}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${origin}/pricing`, changeFrequency: "weekly", priority: 0.9 },
    { url: `${origin}/docs`, changeFrequency: "weekly", priority: 0.8 },
    ...DOC_PAGES.map((page) => ({
      url: `${origin}/docs/${page.slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
    // Derived, so the cookie policy is listed only while it exists.
    ...LEGAL_DOCUMENTS.map((document) => ({
      url: `${origin}/${document.slug}`,
      changeFrequency: "yearly" as const,
      priority: 0.3,
    })),
  ];
}
