import { COOKIE_POLICY } from "@/features/legal/content/cookies";
import { PRIVACY_POLICY } from "@/features/legal/content/privacy";
import { TERMS_OF_SERVICE } from "@/features/legal/content/terms";
import { usesCookiesOrSimilar } from "@/features/legal/cookies";
import type { LegalDocument } from "@/features/legal/types";

/**
 * Which legal pages exist.
 *
 * The cookie policy is conditional on the application actually storing
 * something in a browser. That is not ceremony: publishing a cookie policy for
 * a site that sets no cookies is its own kind of inaccuracy, and deriving it
 * means the page, the footer link, the sitemap and the tests all agree without
 * anyone remembering to update four places.
 */
export const LEGAL_DOCUMENTS: ReadonlyArray<LegalDocument> = [
  TERMS_OF_SERVICE,
  PRIVACY_POLICY,
  ...(usesCookiesOrSimilar() ? [COOKIE_POLICY] : []),
];

export function findLegalDocument(slug: string): LegalDocument | undefined {
  return LEGAL_DOCUMENTS.find((document) => document.slug === slug);
}

/** Footer and sitemap entries, in the order they should be listed. */
export function legalLinks(): Array<{ href: string; label: string }> {
  return LEGAL_DOCUMENTS.map((document) => ({
    href: `/${document.slug}`,
    label: document.slug === "cookies" ? "Cookies" : document.slug === "privacy" ? "Privacy" : "Terms",
  }));
}
