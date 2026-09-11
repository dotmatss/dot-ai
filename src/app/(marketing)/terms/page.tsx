import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LegalPage } from "@/features/legal/components/legal-page";
import { findLegalDocument } from "@/features/legal/registry";

const SLUG = "terms";

export function generateMetadata(): Metadata {
  const document = findLegalDocument(SLUG);
  if (!document) return { title: "Not found" };
  return {
    title: document.title,
    description: document.description,
    alternates: { canonical: `/${SLUG}` },
    openGraph: { title: document.title, description: document.description, type: "article" },
  };
}

/**
 * Terms of Service.
 *
 * The content lives in `src/features/legal/content/`, so updating the policy
 * never means touching a component. The page is a Server Component and ships
 * no JavaScript of its own.
 *
 * It resolves through the registry rather than importing the document
 * directly: the cookie policy exists only while the application actually
 * stores something in a browser, and this route answers 404 when it does not.
 */
export default function TermsPage() {
  const document = findLegalDocument(SLUG);
  if (!document) notFound();
  return <LegalPage document={document} />;
}
