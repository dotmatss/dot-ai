import { DOC_SECTIONS } from "@/features/docs/registry";
import { searchTextOf } from "@/features/docs/types";

export interface DocSearchEntry {
  slug: string;
  title: string;
  description: string;
  section: string;
  /** Lower-cased page text, used for matching. */
  haystack: string;
}

/**
 * Search index built from the same content the pages render.
 *
 * It is a plain array rather than a service: the documentation is a few dozen
 * pages, so filtering it in the browser is instant and costs no request, no
 * index to keep in sync and no third-party search dependency. Revisit if the
 * corpus grows past a few hundred pages.
 */
export const DOC_SEARCH_INDEX: DocSearchEntry[] = DOC_SECTIONS.flatMap((section) =>
  section.pages.map((page) => ({
    slug: page.slug,
    title: page.title,
    description: page.description,
    section: section.title,
    haystack: searchTextOf(page),
  })),
);

export function searchDocs(query: string, limit = 8): DocSearchEntry[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  return DOC_SEARCH_INDEX.map((entry) => {
    let score = 0;
    for (const term of terms) {
      // Title matches outrank body matches, so "chat api" finds the reference
      // page rather than every page that mentions the API in passing.
      if (entry.title.toLowerCase().includes(term)) score += 10;
      if (entry.description.toLowerCase().includes(term)) score += 4;
      if (entry.haystack.includes(term)) score += 1;
    }
    return { entry, score };
  })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((result) => result.entry);
}
