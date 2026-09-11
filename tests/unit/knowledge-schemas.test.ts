import { describe, expect, it } from "vitest";

import { parseCollectionFilters, parseKnowledgeSourceFilters } from "@/features/knowledge/filters";
import {
  createCollectionSchema,
  createSourceSchema,
  ingestUrlSchema,
  collectionListQuerySchema,
  knowledgeScopeParamSchema,
  knowledgeSearchSchema,
  moveSourceSchema,
  toKnowledgeScope,
  updateCollectionSchema,
  urlSourceFormSchema,
} from "@/features/knowledge/schemas";
import { TEXT_SOURCE_MAX_CHARS } from "@/features/knowledge/constants";

describe("createCollectionSchema", () => {
  it("requires a usable name and trims input", () => {
    expect(createCollectionSchema.safeParse({ name: "A" }).success).toBe(false);
    const result = createCollectionSchema.safeParse({ name: "  Product docs  ", description: " Public help " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ name: "Product docs", description: "Public help" });
  });

  it("rejects an over-long description", () => {
    expect(createCollectionSchema.safeParse({ name: "Docs", description: "x".repeat(281) }).success).toBe(false);
  });
});

describe("updateCollectionSchema", () => {
  it("rejects an empty patch and accepts a partial one", () => {
    expect(updateCollectionSchema.safeParse({}).success).toBe(false);
    expect(updateCollectionSchema.safeParse({ name: "Renamed" }).success).toBe(true);
    expect(updateCollectionSchema.safeParse({ description: null }).success).toBe(true);
  });
});

describe("collectionListQuerySchema", () => {
  it("applies defaults and coerces numeric strings", () => {
    const result = collectionListQuerySchema.safeParse({ page: "3" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ page: 3, pageSize: 20, q: undefined, status: undefined });
  });

  it("rejects an unknown status and an out-of-range page size", () => {
    expect(collectionListQuerySchema.safeParse({ status: "bogus" }).success).toBe(false);
    expect(collectionListQuerySchema.safeParse({ pageSize: "1000" }).success).toBe(false);
    expect(collectionListQuerySchema.safeParse({ page: "0" }).success).toBe(false);
  });
});

describe("ingestUrlSchema", () => {
  it("normalizes an accepted URL", () => {
    expect(ingestUrlSchema.parse(" https://example.com/docs#top ")).toBe("https://example.com/docs");
  });

  it("surfaces the safety reason as the field error", () => {
    const result = ingestUrlSchema.safeParse("http://169.254.169.254/latest/meta-data/");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toContain("not publicly reachable");
  });
});

describe("createSourceSchema", () => {
  it("accepts a text source and trims its fields", () => {
    const result = createSourceSchema.safeParse({ type: "text", name: " Refunds ", content: " Within 30 days. " });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "text") {
      expect(result.data.name).toBe("Refunds");
      expect(result.data.content).toBe("Within 30 days.");
    }
  });

  it("rejects empty and over-long text content", () => {
    expect(createSourceSchema.safeParse({ type: "text", name: "Refunds", content: "   " }).success).toBe(false);
    expect(
      createSourceSchema.safeParse({ type: "text", name: "Refunds", content: "x".repeat(TEXT_SOURCE_MAX_CHARS + 1) })
        .success,
    ).toBe(false);
  });

  it("accepts a URL source with an optional name", () => {
    const result = createSourceSchema.safeParse({ type: "url", url: "https://example.com/a" });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "url") {
      expect(result.data.url).toBe("https://example.com/a");
      expect(result.data.name).toBeUndefined();
    }
  });

  it("rejects a URL source pointing at a private host", () => {
    expect(createSourceSchema.safeParse({ type: "url", url: "http://192.168.0.1/" }).success).toBe(false);
  });

  it("rejects an unknown source type, including file (uploads use their own route)", () => {
    expect(createSourceSchema.safeParse({ type: "file", name: "a.txt" }).success).toBe(false);
    expect(createSourceSchema.safeParse({ type: "other", name: "a" }).success).toBe(false);
  });
});

describe("urlSourceFormSchema", () => {
  it("keeps the normalized URL and an empty optional name", () => {
    const result = urlSourceFormSchema.safeParse({ url: "https://example.com/a#b", name: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ url: "https://example.com/a", name: "" });
  });
});

describe("knowledgeSearchSchema", () => {
  it("defaults the limit and enforces a minimum query length", () => {
    const result = knowledgeSearchSchema.safeParse({ query: " refunds " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ query: "refunds", limit: 8 });
    expect(knowledgeSearchSchema.safeParse({ query: "a" }).success).toBe(false);
  });

  it("caps the limit", () => {
    expect(knowledgeSearchSchema.safeParse({ query: "refunds", limit: 21 }).success).toBe(false);
    expect(knowledgeSearchSchema.safeParse({ query: "refunds", limit: "5" }).success).toBe(true);
  });
});

describe("parseCollectionFilters", () => {
  it("normalizes URL params into filters shared with the server", () => {
    expect(parseCollectionFilters({ q: " docs ", status: "ready", page: "4" })).toEqual({
      q: "docs",
      status: "ready",
      page: 4,
      pageSize: 20,
    });
  });

  it("drops unknown statuses, blank searches and bad pages", () => {
    expect(parseCollectionFilters({ q: "  ", status: "bogus", page: "-2" })).toEqual({
      q: undefined,
      status: undefined,
      page: 1,
      pageSize: 20,
    });
    expect(parseCollectionFilters({})).toEqual({ q: undefined, status: undefined, page: 1, pageSize: 20 });
  });

  it("uses the first value when a param repeats", () => {
    expect(parseCollectionFilters({ status: ["error", "ready"] }).status).toBe("error");
  });
});

describe("parseKnowledgeSourceFilters", () => {
  it("normalizes the page and applies the given page size", () => {
    expect(parseKnowledgeSourceFilters({ page: "2" }, 20)).toEqual({
      q: undefined,
      status: undefined,
      page: 2,
      pageSize: 20,
    });
    expect(parseKnowledgeSourceFilters({ page: "nope" }, 50)).toEqual({
      q: undefined,
      status: undefined,
      page: 1,
      pageSize: 50,
    });
  });

  it("carries the search term and a known source status", () => {
    expect(parseKnowledgeSourceFilters({ q: " handbook ", status: "failed" }, 20)).toEqual({
      q: "handbook",
      status: "failed",
      page: 1,
      pageSize: 20,
    });
  });

  it("drops a status that is not a source status", () => {
    // "ready" is shared with collections, but "empty" is a collection status only.
    expect(parseKnowledgeSourceFilters({ status: "empty" }, 20).status).toBeUndefined();
    expect(parseKnowledgeSourceFilters({ status: "ready" }, 20).status).toBe("ready");
  });
});

describe("knowledgeScopeParamSchema", () => {
  it("accepts the two reserved words and a collection id", () => {
    expect(knowledgeScopeParamSchema.safeParse("all").success).toBe(true);
    expect(knowledgeScopeParamSchema.safeParse("unorganized").success).toBe(true);
    expect(knowledgeScopeParamSchema.safeParse("3f1c2b8e-5a4d-4a2f-9c1e-7b6d5a4f3e2d").success).toBe(true);
  });

  it("rejects anything else, so a scope can never be a stray string", () => {
    expect(knowledgeScopeParamSchema.safeParse("").success).toBe(false);
    expect(knowledgeScopeParamSchema.safeParse("none").success).toBe(false);
    expect(knowledgeScopeParamSchema.safeParse("null").success).toBe(false);
  });

  it("maps each accepted value onto a distinct scope", () => {
    expect(toKnowledgeScope("all")).toEqual({ kind: "all" });
    expect(toKnowledgeScope("unorganized")).toEqual({ kind: "unorganized" });
    expect(toKnowledgeScope("3f1c2b8e-5a4d-4a2f-9c1e-7b6d5a4f3e2d")).toEqual({
      kind: "collection",
      collectionId: "3f1c2b8e-5a4d-4a2f-9c1e-7b6d5a4f3e2d",
    });
  });
});

describe("moveSourceSchema", () => {
  it("accepts a collection id and an explicit null for Unorganized", () => {
    expect(moveSourceSchema.safeParse({ collectionId: "3f1c2b8e-5a4d-4a2f-9c1e-7b6d5a4f3e2d" }).success).toBe(true);
    expect(moveSourceSchema.safeParse({ collectionId: null }).success).toBe(true);
  });

  it("rejects an omitted key, so clearing is always deliberate", () => {
    expect(moveSourceSchema.safeParse({}).success).toBe(false);
    expect(moveSourceSchema.safeParse({ collectionId: "unorganized" }).success).toBe(false);
  });
});
