import { describe, expect, it } from "vitest";

import { SLUG_PATTERN, slugify, withSuffix } from "@/lib/slug";

describe("slugify", () => {
  it("lowercases, strips diacritics and replaces separators", () => {
    expect(slugify("Customer Support — Ünïcode Bot!")).toBe("customer-support-unicode-bot");
  });

  it("trims leading/trailing dashes and respects max length", () => {
    expect(slugify("  --hello world--  ")).toBe("hello-world");
    expect(slugify("a".repeat(100), 10)).toHaveLength(10);
  });

  it("falls back for empty input", () => {
    expect(slugify("!!!")).toBe("untitled");
  });

  it("produces values matching the slug pattern", () => {
    for (const input of ["Acme Inc.", "  Sales / EMEA  ", "日本語", "x"]) {
      expect(SLUG_PATTERN.test(slugify(input))).toBe(true);
    }
  });
});

describe("withSuffix", () => {
  it("returns the root for the first attempt and numbered suffixes afterwards", () => {
    expect(withSuffix("acme", 0)).toBe("acme");
    expect(withSuffix("acme", 1)).toBe("acme-2");
    expect(withSuffix("acme", 4)).toBe("acme-5");
  });
});
