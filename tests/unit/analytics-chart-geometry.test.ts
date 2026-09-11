import { describe, expect, it } from "vitest";

import {
  areaPath,
  axisTicks,
  barHeightPercent,
  chartPoints,
  niceCeil,
  polylinePoints,
  type ChartBox,
} from "@/features/analytics/chart-geometry";

const box: ChartBox = { width: 100, height: 50 };

describe("niceCeil", () => {
  it("rounds up to 1, 2 or 5 times a power of ten", () => {
    expect(niceCeil(1)).toBe(1);
    expect(niceCeil(1.5)).toBe(2);
    expect(niceCeil(3)).toBe(5);
    expect(niceCeil(6)).toBe(10);
    expect(niceCeil(10)).toBe(10);
    expect(niceCeil(12)).toBe(20);
    expect(niceCeil(230)).toBe(500);
    expect(niceCeil(1000)).toBe(1000);
  });

  it("works below one", () => {
    expect(niceCeil(0.4)).toBe(0.5);
    expect(niceCeil(0.06)).toBeCloseTo(0.1, 10);
  });

  it("gives an empty chart an axis of 1 instead of dividing by zero", () => {
    expect(niceCeil(0)).toBe(1);
    expect(niceCeil(-5)).toBe(1);
    expect(niceCeil(Number.NaN)).toBe(1);
    expect(niceCeil(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("axisTicks", () => {
  it("spans zero to a nice maximum, ascending", () => {
    expect(axisTicks(100)).toEqual([0, 50, 100]);
    expect(axisTicks(100, 5)).toEqual([0, 25, 50, 75, 100]);
  });

  it("rounds the top before splitting it", () => {
    expect(axisTicks(30)).toEqual([0, 25, 50]);
  });

  it("still produces a readable axis for an all-zero chart", () => {
    expect(axisTicks(0)).toEqual([0, 0.5, 1]);
  });

  it("never collapses to a single gridline", () => {
    expect(axisTicks(100, 1)).toEqual([0, 100]);
    expect(axisTicks(100, 0)).toEqual([0, 100]);
  });
});

describe("chartPoints", () => {
  it("spreads values across the box and inverts the y-axis", () => {
    // max 10 -> niceCeil 10, so 10 sits at the top and 0 on the baseline.
    expect(chartPoints([0, 5, 10], box)).toEqual([
      { x: 0, y: 50 },
      { x: 50, y: 25 },
      { x: 100, y: 0 },
    ]);
  });

  it("centres a single point, because one bucket has no line", () => {
    expect(chartPoints([5], box)).toEqual([{ x: 50, y: 0 }]);
  });

  it("returns nothing for an empty series", () => {
    expect(chartPoints([], box)).toEqual([]);
  });

  it("honours the padding inset so a stroke at the top is not clipped", () => {
    expect(chartPoints([0, 10], { width: 100, height: 50, padding: 5 })).toEqual([
      { x: 5, y: 45 },
      { x: 95, y: 5 },
    ]);
  });

  it("shares one scale when an explicit max is given", () => {
    const scaled = chartPoints([5], box, 10);
    expect(scaled).toEqual([{ x: 50, y: 25 }]);
  });

  it("clamps a value above the axis top and floors a negative one", () => {
    expect(chartPoints([20, -4], box, 10)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ]);
  });
});

describe("polylinePoints", () => {
  it("emits an SVG points attribute", () => {
    expect(polylinePoints([0, 5, 10], box)).toBe("0,50 50,25 100,0");
  });

  it("emits one coordinate for a single point", () => {
    expect(polylinePoints([5], box)).toBe("50,0");
  });

  it("draws an all-zero series flat on the baseline rather than at the top", () => {
    // niceCeil(0) is 1, so every value maps to the bottom of the box.
    expect(polylinePoints([0, 0, 0], box)).toBe("0,50 50,50 100,50");
  });

  it("is empty for an empty series", () => {
    expect(polylinePoints([], box)).toBe("");
  });
});

describe("areaPath", () => {
  it("closes the line down to the baseline", () => {
    expect(areaPath([0, 10], box)).toBe("M0 50 L0 50 L100 0 L100 50 Z");
  });

  it("has no area for fewer than two points", () => {
    expect(areaPath([5], box)).toBe("");
    expect(areaPath([], box)).toBe("");
  });
});

describe("barHeightPercent", () => {
  it("is the value as a percentage of the tallest bar", () => {
    expect(barHeightPercent(5, 10)).toBe(50);
    expect(barHeightPercent(10, 10)).toBe(100);
    expect(barHeightPercent(1, 3)).toBe(33.33);
  });

  it("never exceeds the tallest bar", () => {
    expect(barHeightPercent(20, 10)).toBe(100);
  });

  it("is zero for an empty bucket, and does not divide by zero", () => {
    expect(barHeightPercent(0, 10)).toBe(0);
    expect(barHeightPercent(0, 0)).toBe(0);
    expect(barHeightPercent(-3, 10)).toBe(0);
    expect(barHeightPercent(Number.NaN, 10)).toBe(0);
    expect(barHeightPercent(5, 0)).toBe(100);
  });
});
