import type { DocBlock } from "@/features/docs/types";
import type { ReviewArea } from "@/features/legal/review-notes";

/**
 * A legal document is content, not markup.
 *
 * It reuses the documentation block model and its renderer, so headings,
 * tables, lists and callouts look and behave identically across the public
 * site, and so there is exactly one place where content becomes React
 * elements. Editing a policy means editing data in
 * `src/features/legal/content/`, never a component.
 */
export interface LegalDocument {
  /** Path under the site root, e.g. "terms". */
  slug: "terms" | "privacy" | "cookies";
  title: string;
  /** One sentence, used for the page description and metadata. */
  description: string;
  /**
   * When the document takes effect. A placeholder until it has been reviewed
   * and published: a date implies the text was settled on that day.
   */
  effectiveDate: string;
  /** When the text itself last changed. */
  lastUpdated: string;
  /** Review areas surfaced on this page. */
  reviewAreas: ReviewArea[];
  blocks: DocBlock[];
}

/** Every heading in a document, for the on-page contents list. */
export function legalHeadings(document: LegalDocument): Array<{ id: string; text: string }> {
  return document.blocks
    .filter((block): block is Extract<DocBlock, { type: "heading" }> => block.type === "heading")
    .map((block) => ({ id: block.id, text: block.text }));
}

/**
 * All text in a document, for placeholder and safety checks.
 *
 * The effective date is included deliberately: it is itself a placeholder
 * until the document has been reviewed, and leaving it out meant the page's
 * "values still to be supplied" list quietly omitted the most important one.
 */
export function legalText(document: LegalDocument): string {
  return [document.effectiveDate, JSON.stringify(document.blocks)].join("\n");
}
