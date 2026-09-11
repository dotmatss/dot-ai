import { describe, expect, it } from "vitest";

import {
  comparisonDelta,
  deltaPercent,
  OTHER_ROW_ID,
  rankWithOther,
  seriesMax,
  seriesTotal,
  shareOfTotal,
  successRate,
  type RankedRow,
} from "@/features/analytics/metrics";

describe("deltaPercent", () => {
  it("returns the percentage change for two non-zero periods", () => {
    expect(deltaPercent(150, 100)).toBe(50);
    expect(deltaPercent(50, 100)).toBe(-50);
    expect(deltaPercent(100, 100)).toBe(0);
  });

  it("returns null for 0 -> n, because no percentage describes it", () => {
    // Rendering +Infinity% or a fabricated +100% would be a lie; callers show
    // the raw comparison instead.
    expect(deltaPercent(12, 0)).toBeNull();
    expect(deltaPercent(1, 0)).toBeNull();
  });

  it("returns -100 for n -> 0", () => {
    expect(deltaPercent(0, 12)).toBe(-100);
  });

  it("treats two zeroes as genuinely unchanged", () => {
    expect(deltaPercent(0, 0)).toBe(0);
  });

  it("returns null rather than NaN for non-finite input", () => {
    expect(deltaPercent(Number.NaN, 10)).toBeNull();
    expect(deltaPercent(10, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("comparisonDelta reads the same numbers off a MetricComparison", () => {
    expect(comparisonDelta({ current: 150, previous: 100 })).toBe(50);
    expect(comparisonDelta({ current: 3, previous: 0 })).toBeNull();
    expect(comparisonDelta({ current: 0, previous: 0 })).toBe(0);
  });
});

describe("shareOfTotal and successRate", () => {
  it("is a percentage of the total", () => {
    expect(shareOfTotal(25, 100)).toBe(25);
    expect(shareOfTotal(1, 3)).toBeCloseTo(33.333, 3);
  });

  it("has no share of a non-positive total", () => {
    expect(shareOfTotal(5, 0)).toBe(0);
    expect(shareOfTotal(5, -10)).toBe(0);
    expect(shareOfTotal(0, 0)).toBe(0);
  });

  it("never exceeds 100", () => {
    expect(shareOfTotal(200, 100)).toBe(100);
  });

  it("successRate of no runs is zero, not 100", () => {
    expect(successRate(0, 0)).toBe(0);
    expect(successRate(3, 4)).toBe(75);
  });
});

describe("seriesTotal and seriesMax", () => {
  const buckets = [
    { start: "2024-03-01T00:00:00.000Z", value: 3 },
    { start: "2024-03-02T00:00:00.000Z", value: 0 },
    { start: "2024-03-03T00:00:00.000Z", value: 9 },
  ];

  it("sums and peaks", () => {
    expect(seriesTotal(buckets)).toBe(12);
    expect(seriesMax(buckets)).toBe(9);
  });

  it("an empty series totals and peaks at zero", () => {
    expect(seriesTotal([])).toBe(0);
    expect(seriesMax([])).toBe(0);
  });
});

describe("rankWithOther", () => {
  const rows = (count: number): RankedRow[] =>
    Array.from({ length: count }, (_, index) => ({ id: `r${index}`, label: `Row ${index}`, value: count - index }));

  it("sorts by value, descending", () => {
    const ranked = rankWithOther(
      [
        { id: "a", label: "A", value: 1 },
        { id: "b", label: "B", value: 9 },
      ],
      3,
    );
    expect(ranked.map((row) => row.id)).toEqual(["b", "a"]);
  });

  it("breaks ties on the label so the order is stable", () => {
    const ranked = rankWithOther(
      [
        { id: "z", label: "Zeta", value: 5 },
        { id: "a", label: "Alpha", value: 5 },
      ],
      5,
    );
    expect(ranked.map((row) => row.id)).toEqual(["a", "z"]);
  });

  it("returns every row when there are fewer than the limit", () => {
    const ranked = rankWithOther(rows(3), 5);
    expect(ranked).toHaveLength(3);
    expect(ranked.some((row) => row.id === OTHER_ROW_ID)).toBe(false);
  });

  it("returns every row at exactly the limit, with no Other", () => {
    const ranked = rankWithOther(rows(5), 5);
    expect(ranked).toHaveLength(5);
    expect(ranked.some((row) => row.id === OTHER_ROW_ID)).toBe(false);
  });

  it("collapses the tail past the limit instead of dropping it", () => {
    // values are 7..1, so the tail beyond the top 3 is 4+3+2+1.
    const ranked = rankWithOther(rows(7), 3);
    expect(ranked).toHaveLength(4);
    expect(ranked.slice(0, 3).map((row) => row.value)).toEqual([7, 6, 5]);
    expect(ranked[3]).toEqual({ id: OTHER_ROW_ID, label: "Other", value: 10 });
  });

  it("uses the label given for the collapsed row", () => {
    const ranked = rankWithOther(rows(4), 2, "Everyone else");
    expect(ranked[2]?.label).toBe("Everyone else");
  });

  it("omits Other when the whole tail is zero", () => {
    const ranked = rankWithOther(
      [
        { id: "a", label: "A", value: 4 },
        { id: "b", label: "B", value: 0 },
        { id: "c", label: "C", value: 0 },
      ],
      1,
    );
    expect(ranked).toEqual([{ id: "a", label: "A", value: 4 }]);
  });

  it("returns nothing for a non-positive limit", () => {
    expect(rankWithOther(rows(4), 0)).toEqual([]);
  });

  it("does not mutate the rows it was given", () => {
    const input = rows(4);
    rankWithOther(input, 2);
    expect(input.map((row) => row.id)).toEqual(["r0", "r1", "r2", "r3"]);
  });
});
