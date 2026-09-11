import { describe, expect, it } from "vitest";

import { DOC_PAGES, DOC_SECTIONS, findDocPage, neighboursOf } from "@/features/docs/registry";
import { searchDocs } from "@/features/docs/search-index";
import { headingsOf, searchTextOf, type DocBlock } from "@/features/docs/types";

function allBlocks(): Array<{ slug: string; block: DocBlock }> {
  return DOC_PAGES.flatMap((page) => page.blocks.map((block) => ({ slug: page.slug, block })));
}

/** Every `[label](/internal/path)` written anywhere in the documentation. */
function internalLinks(): Array<{ slug: string; href: string }> {
  const links: Array<{ slug: string; href: string }> = [];
  const pattern = /\[[^\]]+\]\((\/[^)]*)\)/g;
  for (const page of DOC_PAGES) {
    const text = JSON.stringify(page.blocks);
    for (const match of text.matchAll(pattern)) {
      if (match[1]) links.push({ slug: page.slug, href: match[1] });
    }
  }
  return links;
}

describe("documentation structure", () => {
  it("has unique slugs", () => {
    const slugs = DOC_PAGES.map((page) => page.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("gives every page a title and a one-line description", () => {
    for (const page of DOC_PAGES) {
      expect(page.title.length, page.slug).toBeGreaterThan(2);
      expect(page.description.length, page.slug).toBeGreaterThan(20);
      expect(page.blocks.length, page.slug).toBeGreaterThan(0);
    }
  });

  it("keeps heading ids unique within a page, so the table of contents can anchor", () => {
    for (const page of DOC_PAGES) {
      const ids = headingsOf(page).map((heading) => heading.id);
      expect(new Set(ids).size, page.slug).toBe(ids.length);
      for (const id of ids) expect(id, `${page.slug} heading id`).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("orders pages so the pager reaches the ends", () => {
    const first = DOC_PAGES[0]!;
    const last = DOC_PAGES.at(-1)!;
    expect(neighboursOf(first.slug).previous).toBeUndefined();
    expect(neighboursOf(first.slug).next).toBeDefined();
    expect(neighboursOf(last.slug).next).toBeUndefined();
    expect(neighboursOf("no-such-page")).toEqual({});
  });

  it("belongs to exactly one section", () => {
    const counts = new Map<string, number>();
    for (const section of DOC_SECTIONS) {
      for (const page of section.pages) counts.set(page.slug, (counts.get(page.slug) ?? 0) + 1);
    }
    expect([...counts.values()].filter((count) => count !== 1)).toEqual([]);
  });
});

describe("documentation links", () => {
  it("never points at a documentation page that does not exist", () => {
    const broken = internalLinks()
      .filter((link) => link.href.startsWith("/docs/"))
      .filter((link) => !findDocPage(link.href.replace("/docs/", "")))
      .map((link) => `${link.slug} → ${link.href}`);

    expect(broken).toEqual([]);
  });

  it("only links to application routes that exist", () => {
    const KNOWN = ["/sign-in", "/sign-up", "/docs", "/onboarding"];
    const unknown = internalLinks()
      .filter((link) => !link.href.startsWith("/docs/"))
      .filter((link) => !KNOWN.includes(link.href))
      .map((link) => `${link.slug} → ${link.href}`);

    expect(unknown).toEqual([]);
  });
});

describe("documentation safety", () => {
  it("contains no value shaped like a real API key", () => {
    // The key format is `dot_live_` plus 32 url-safe characters. Examples must
    // use a placeholder or an environment variable, never a working credential.
    const realKey = /dot_live_[A-Za-z0-9_-]{32}/;
    const offenders = DOC_PAGES.filter((page) => realKey.test(JSON.stringify(page.blocks))).map((page) => page.slug);
    expect(offenders).toEqual([]);
  });

  it("keeps credentials in placeholders or environment variables in every example", () => {
    const codeBlocks = allBlocks().filter(
      (entry): entry is { slug: string; block: Extract<DocBlock, { type: "code" }> } => entry.block.type === "code",
    );
    const authExamples = codeBlocks.filter((entry) => /Authorization/i.test(entry.block.code));
    expect(authExamples.length).toBeGreaterThan(0);

    for (const entry of authExamples) {
      expect(entry.block.code, `${entry.slug} auth example`).toMatch(/\$DOT_API_KEY|process\.env\.DOT_API_KEY|YOUR_API_KEY/);
    }
  });

  it("documents endpoints that live under the versioned API", () => {
    const endpoints = allBlocks().filter(
      (entry): entry is { slug: string; block: Extract<DocBlock, { type: "endpoint" }> } => entry.block.type === "endpoint",
    );
    expect(endpoints.length).toBeGreaterThan(0);
    for (const entry of endpoints) {
      expect(entry.block.path, entry.slug).toMatch(/^\/api\//);
      expect(entry.block.auth.length, entry.slug).toBeGreaterThan(0);
    }
  });
});

describe("documentation search", () => {
  it("finds a page by its title", () => {
    const results = searchDocs("rate limits");
    expect(results[0]?.slug).toBe("api/rate-limits");
  });

  it("finds a page by words in its body", () => {
    const results = searchDocs("allowed domain");
    expect(results.map((result) => result.slug)).toContain("embed");
  });

  it("returns nothing for an empty or unmatched query", () => {
    expect(searchDocs("")).toEqual([]);
    expect(searchDocs("   ")).toEqual([]);
    expect(searchDocs("zzzzzzzz-not-a-word")).toEqual([]);
  });

  it("indexes the text a reader can actually see", () => {
    const page = findDocPage("api/chat")!;
    const text = searchTextOf(page);
    expect(text).toContain("server-sent events");
    expect(text).toContain("conversationid");
  });
});
