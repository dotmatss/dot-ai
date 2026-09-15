import { describe, expect, it } from "vitest";

import {
  DEFAULT_TOPIC_SORT,
  hasActiveTopicFilters,
  parseTopicFilters,
  parseTopicSort,
} from "@/features/intelligence/filters";
import { topicListQuerySchema } from "@/features/intelligence/schemas";
import { DEFAULT_PAGE_SIZE } from "@/types/pagination";

describe("parseTopicSort", () => {
  it("accepts every supported sort", () => {
    expect(parseTopicSort("volume")).toBe("volume");
    expect(parseTopicSort("gap")).toBe("gap");
    expect(parseTopicSort("recent")).toBe("recent");
  });

  it("normalizes case and whitespace", () => {
    expect(parseTopicSort("  GAP ")).toBe("gap");
  });

  it("falls back rather than throwing on a hand-edited URL", () => {
    expect(parseTopicSort("nonsense")).toBe(DEFAULT_TOPIC_SORT);
    expect(parseTopicSort(undefined)).toBe(DEFAULT_TOPIC_SORT);
    expect(parseTopicSort(null)).toBe(DEFAULT_TOPIC_SORT);
  });

  it("takes the first value when a key is repeated", () => {
    expect(parseTopicSort(["gap", "volume"])).toBe("gap");
  });
});

describe("parseTopicFilters", () => {
  it("defaults an empty URL", () => {
    expect(parseTopicFilters({})).toEqual({
      search: undefined,
      gapsOnly: undefined,
      sort: DEFAULT_TOPIC_SORT,
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
    });
  });

  it("reads a search term and trims it", () => {
    expect(parseTopicFilters({ q: "  refund " }).search).toBe("refund");
  });

  it("drops a search term that is only whitespace", () => {
    expect(parseTopicFilters({ q: "   " }).search).toBeUndefined();
  });

  it("treats a bare flag as on, the way a browser sends a checkbox", () => {
    expect(parseTopicFilters({ gaps: "" }).gapsOnly).toBe(true);
    expect(parseTopicFilters({ gaps: "1" }).gapsOnly).toBe(true);
    expect(parseTopicFilters({ gaps: "true" }).gapsOnly).toBe(true);
  });

  it("treats an explicit off value as off", () => {
    expect(parseTopicFilters({ gaps: "0" }).gapsOnly).toBeUndefined();
    expect(parseTopicFilters({ gaps: "false" }).gapsOnly).toBeUndefined();
  });

  it("clamps a nonsensical page rather than paginating to NaN", () => {
    expect(parseTopicFilters({ page: "0" }).page).toBe(1);
    expect(parseTopicFilters({ page: "-4" }).page).toBe(1);
    expect(parseTopicFilters({ page: "abc" }).page).toBe(1);
    expect(parseTopicFilters({ page: "3.7" }).page).toBe(3);
  });
});

describe("hasActiveTopicFilters", () => {
  it("is false for the default view", () => {
    expect(hasActiveTopicFilters(parseTopicFilters({}))).toBe(false);
  });

  it("is true once anything is narrowed", () => {
    expect(hasActiveTopicFilters(parseTopicFilters({ q: "refund" }))).toBe(true);
    expect(hasActiveTopicFilters(parseTopicFilters({ gaps: "1" }))).toBe(true);
    expect(hasActiveTopicFilters(parseTopicFilters({ sort: "gap" }))).toBe(true);
  });
});

describe("topicListQuerySchema", () => {
  it("agrees with the URL parser about what the gaps flag means", () => {
    // The server parses the query string and the client parses the URL. If
    // these two disagree, a prefetched page and its client refetch describe
    // different sets and hydration silently refetches everything.
    for (const value of ["", "1", "true"] as const) {
      expect(topicListQuerySchema.parse({ gaps: value }).gaps).toBe(true);
      expect(parseTopicFilters({ gaps: value }).gapsOnly).toBe(true);
    }
    for (const value of ["0", "false"] as const) {
      expect(topicListQuerySchema.parse({ gaps: value }).gaps).toBe(false);
      expect(parseTopicFilters({ gaps: value }).gapsOnly).toBeUndefined();
    }
  });

  it("defaults page, pageSize and sort", () => {
    const parsed = topicListQuerySchema.parse({});
    expect(parsed).toMatchObject({ page: 1, pageSize: 20, sort: "volume" });
  });

  it("rejects a page size beyond the cap", () => {
    expect(() => topicListQuerySchema.parse({ pageSize: "5000" })).toThrow();
  });

  it("rejects an unknown sort rather than silently defaulting", () => {
    // Deliberately stricter than the URL parser: a query string reaching an API
    // handler is a request, not a bookmark, and a typo there should be told.
    expect(() => topicListQuerySchema.parse({ sort: "nonsense" })).toThrow();
  });
});
