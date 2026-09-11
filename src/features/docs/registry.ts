import { DEPLOY_PAGES } from "@/features/docs/content/deploy";
import { GETTING_STARTED_PAGES } from "@/features/docs/content/getting-started";
import { PLATFORM_PAGES } from "@/features/docs/content/platform";
import type { DocPage, DocSection } from "@/features/docs/types";

function pick(pages: DocPage[], slugs: string[]): DocPage[] {
  return slugs.map((slug) => {
    const page = pages.find((candidate) => candidate.slug === slug);
    if (!page) throw new Error(`Documentation page "${slug}" is referenced by the navigation but does not exist`);
    return page;
  });
}

/**
 * The documentation's information architecture.
 *
 * Ordered by what a reader does: understand the product, build something,
 * operate it, then ship it. Every entry points at a page that exists — the
 * lookup above fails loudly rather than rendering a dead link.
 */
export const DOC_SECTIONS: DocSection[] = [
  {
    title: "Getting started",
    pages: pick(GETTING_STARTED_PAGES, ["getting-started", "concepts"]),
  },
  {
    title: "Building",
    pages: pick(PLATFORM_PAGES, ["chatbots", "agents", "workflows", "knowledge"]),
  },
  {
    title: "Operating",
    pages: pick(PLATFORM_PAGES, ["conversations", "crm", "analytics", "integrations"]),
  },
  {
    title: "Deploying",
    pages: pick(DEPLOY_PAGES, ["embed", "api/authentication", "api/chat", "api/errors", "api/rate-limits"]),
  },
  {
    title: "Reference",
    pages: pick(DEPLOY_PAGES, ["examples"]),
  },
];

export const DOC_PAGES: DocPage[] = DOC_SECTIONS.flatMap((section) => section.pages);

export function findDocPage(slug: string): DocPage | undefined {
  return DOC_PAGES.find((page) => page.slug === slug);
}

export function sectionOf(slug: string): DocSection | undefined {
  return DOC_SECTIONS.find((section) => section.pages.some((page) => page.slug === slug));
}

/** Previous and next pages in reading order, for the pager at the foot of a page. */
export function neighboursOf(slug: string): { previous?: DocPage; next?: DocPage } {
  const index = DOC_PAGES.findIndex((page) => page.slug === slug);
  if (index === -1) return {};
  return { previous: DOC_PAGES[index - 1], next: DOC_PAGES[index + 1] };
}
