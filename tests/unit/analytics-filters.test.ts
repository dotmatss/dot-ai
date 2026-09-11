import { describe, expect, it } from "vitest";

import { DEFAULT_ANALYTICS_PERIOD } from "@/features/analytics/constants";
import { ANALYTICS_FILTER_KEYS, hasExplicitPeriod, parseAnalyticsFilters, parseAnalyticsPeriod } from "@/features/analytics/filters";

describe("parseAnalyticsPeriod", () => {
  it("accepts every supported window", () => {
    expect(parseAnalyticsPeriod("7d")).toBe("7d");
    expect(parseAnalyticsPeriod("30d")).toBe("30d");
    expect(parseAnalyticsPeriod("90d")).toBe("90d");
  });

  it("normalizes case and surrounding whitespace", () => {
    expect(parseAnalyticsPeriod("  90D ")).toBe("90d");
    expect(parseAnalyticsPeriod("7D")).toBe("7d");
  });

  it("falls back to the default for junk rather than throwing", () => {
    // The value comes from the URL, so a hand-edited link must still render.
    expect(parseAnalyticsPeriod("all-time")).toBe(DEFAULT_ANALYTICS_PERIOD);
    expect(parseAnalyticsPeriod("")).toBe(DEFAULT_ANALYTICS_PERIOD);
    expect(parseAnalyticsPeriod("7")).toBe(DEFAULT_ANALYTICS_PERIOD);
    expect(parseAnalyticsPeriod("30d; drop table")).toBe(DEFAULT_ANALYTICS_PERIOD);
    expect(parseAnalyticsPeriod("__proto__")).toBe(DEFAULT_ANALYTICS_PERIOD);
  });

  it("falls back to the default for a missing value", () => {
    expect(parseAnalyticsPeriod(undefined)).toBe(DEFAULT_ANALYTICS_PERIOD);
    expect(parseAnalyticsPeriod(null)).toBe(DEFAULT_ANALYTICS_PERIOD);
  });

  it("takes the first entry when the param repeats", () => {
    expect(parseAnalyticsPeriod(["7d", "90d"])).toBe("7d");
    expect(parseAnalyticsPeriod(["nonsense", "7d"])).toBe(DEFAULT_ANALYTICS_PERIOD);
    expect(parseAnalyticsPeriod([])).toBe(DEFAULT_ANALYTICS_PERIOD);
  });
});

describe("parseAnalyticsFilters", () => {
  it("defaults when no period is in the URL", () => {
    expect(parseAnalyticsFilters({})).toEqual({ period: DEFAULT_ANALYTICS_PERIOD });
  });

  it("reads the period and ignores unrelated params", () => {
    expect(parseAnalyticsFilters({ period: "90d", page: "3" })).toEqual({ period: "90d" });
  });

  it("handles an array value from a repeated param", () => {
    expect(parseAnalyticsFilters({ period: ["90d"] })).toEqual({ period: "90d" });
  });

  it("only owns the period key", () => {
    expect(ANALYTICS_FILTER_KEYS).toEqual(["period"]);
  });
});

describe("hasExplicitPeriod", () => {
  it("is false when absent or when it resolves to the default", () => {
    expect(hasExplicitPeriod({})).toBe(false);
    expect(hasExplicitPeriod({ period: DEFAULT_ANALYTICS_PERIOD })).toBe(false);
    expect(hasExplicitPeriod({ period: "junk" })).toBe(false);
  });

  it("is true when the URL pins a non-default window", () => {
    expect(hasExplicitPeriod({ period: "7d" })).toBe(true);
    expect(hasExplicitPeriod({ period: ["90d", "7d"] })).toBe(true);
  });
});
