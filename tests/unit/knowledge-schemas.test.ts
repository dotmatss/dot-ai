import { describe, expect, it } from "vitest";

import { parseKnowledgeBaseFilters, parseKnowledgeSourceFilters } from "@/features/knowledge/filters";
import {
  createKnowledgeBaseSchema,
  createSourceSchema,
  ingestUrlSchema,
  knowledgeBaseListQuerySchema,
  knowledgeSearchSchema,
  updateKnowledgeBaseSchema,
  urlSourceFormSchema,
} from "@/features/knowledge/schemas";
import { TEXT_SOURCE_MAX_CHARS } from "@/features/knowledge/constants";

describe("createKnowledgeBaseSchema", () => {
  it("requires a usable name and trims input", () => {
    expect(createKnowledgeBaseSchema.safeParse({ name: "A" }).success).toBe(false);
    const result = createKnowledgeBaseSchema.safeParse({ name: "  Product docs  ", description: " Public help " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ name: "Product docs", description: "Public help" });
  });

  it("rejects an over-long description", () => {
    expect(createKnowledgeBaseSchema.safeParse({ name: "Docs", description: "x".repeat(281) }).success).toBe(false);
  });
});

describe("updateKnowledgeBaseSchema", () => {
  it("rejects an empty patch and accepts a partial one", () => {
    expect(updateKnowledgeBaseSchema.safeParse({}).success).toBe(false);
    expect(updateKnowledgeBaseSchema.safeParse({ name: "Renamed" }).success).toBe(true);
    expect(updateKnowledgeBaseSchema.safeParse({ description: null }).success).toBe(true);
  });
});

describe("knowledgeBaseListQuerySchema", () => {
  it("applies defaults and coerces numeric strings", () => {
    const result = knowledgeBaseListQuerySchema.safeParse({ page: "3" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ page: 3, pageSize: 20, q: undefined, status: undefined });
  });

  it("rejects an unknown status and an out-of-range page size", () => {
    expect(knowledgeBaseListQuerySchema.safeParse({ status: "bogus" }).success).toBe(false);
    expect(knowledgeBaseListQuerySchema.safeParse({ pageSize: "1000" }).success).toBe(false);
    expect(knowledgeBaseListQuerySchema.safeParse({ page: "0" }).success).toBe(false);
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

describe("parseKnowledgeBaseFilters", () => {
  it("normalizes URL params into filters shared with the server", () => {
    expect(parseKnowledgeBaseFilters({ q: " docs ", status: "ready", page: "4" })).toEqual({
      q: "docs",
      status: "ready",
      page: 4,
      pageSize: 20,
    });
  });

  it("drops unknown statuses, blank searches and bad pages", () => {
    expect(parseKnowledgeBaseFilters({ q: "  ", status: "bogus", page: "-2" })).toEqual({
      q: undefined,
      status: undefined,
      page: 1,
      pageSize: 20,
    });
    expect(parseKnowledgeBaseFilters({})).toEqual({ q: undefined, status: undefined, page: 1, pageSize: 20 });
  });

  it("uses the first value when a param repeats", () => {
    expect(parseKnowledgeBaseFilters({ status: ["error", "ready"] }).status).toBe("error");
  });
});

describe("parseKnowledgeSourceFilters", () => {
  it("normalizes the page and applies the given page size", () => {
    expect(parseKnowledgeSourceFilters({ page: "2" }, 20)).toEqual({ page: 2, pageSize: 20 });
    expect(parseKnowledgeSourceFilters({ page: "nope" }, 50)).toEqual({ page: 1, pageSize: 50 });
  });
});
