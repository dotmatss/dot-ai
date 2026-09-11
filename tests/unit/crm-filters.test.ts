import { describe, expect, it } from "vitest";

import { hasActiveContactFilters, parseContactFilters, parsePageParam } from "@/features/crm/filters";
import { DEFAULT_PAGE_SIZE } from "@/types/pagination";

describe("parseContactFilters", () => {
  it("returns defaults for empty params", () => {
    expect(parseContactFilters({})).toEqual({ q: undefined, stage: undefined, tag: undefined, page: 1, pageSize: DEFAULT_PAGE_SIZE });
  });

  it("keeps a known stage and drops an unknown one", () => {
    expect(parseContactFilters({ stage: "customer" }).stage).toBe("customer");
    expect(parseContactFilters({ stage: "vip" }).stage).toBeUndefined();
  });

  it("normalizes the tag the same way stored tags are normalized", () => {
    expect(parseContactFilters({ tag: "  Enterprise   Lead " }).tag).toBe("enterprise lead");
    expect(parseContactFilters({ tag: "   " }).tag).toBeUndefined();
  });

  it("trims the search term and treats blank as absent", () => {
    expect(parseContactFilters({ q: "  ada  " }).q).toBe("ada");
    expect(parseContactFilters({ q: "   " }).q).toBeUndefined();
  });

  it("takes the first value when a param repeats", () => {
    expect(parseContactFilters({ stage: ["lead", "customer"] }).stage).toBe("lead");
  });

  it("falls back to page 1 for invalid page values", () => {
    expect(parseContactFilters({ page: "3" }).page).toBe(3);
    expect(parseContactFilters({ page: "0" }).page).toBe(1);
    expect(parseContactFilters({ page: "-2" }).page).toBe(1);
    expect(parseContactFilters({ page: "abc" }).page).toBe(1);
    expect(parseContactFilters({ page: "2.7" }).page).toBe(2);
  });

  it("produces the same object for the same params so query keys match", () => {
    expect(parseContactFilters({ q: "ada", stage: "lead" })).toEqual(parseContactFilters({ stage: "lead", q: "ada" }));
  });
});

describe("hasActiveContactFilters", () => {
  it("ignores pagination", () => {
    expect(hasActiveContactFilters(parseContactFilters({ page: "4" }))).toBe(false);
  });

  it("detects each user-adjustable filter", () => {
    expect(hasActiveContactFilters(parseContactFilters({ q: "ada" }))).toBe(true);
    expect(hasActiveContactFilters(parseContactFilters({ stage: "churned" }))).toBe(true);
    expect(hasActiveContactFilters(parseContactFilters({ tag: "vip" }))).toBe(true);
  });
});

describe("parsePageParam", () => {
  it("defaults to the first page", () => {
    expect(parsePageParam({})).toBe(1);
    expect(parsePageParam({ page: "nope" })).toBe(1);
    expect(parsePageParam({ page: "5" })).toBe(5);
  });
});
