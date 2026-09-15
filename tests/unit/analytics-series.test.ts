import { describe, expect, it } from "vitest";

import { PERIOD_META } from "@/features/analytics/constants";
import {
  alignSeries,
  bucketStepMs,
  formatBucketLabel,
  formatBucketRange,
  resolveAnalyticsRange,
} from "@/features/analytics/series";
import type { TimeBucket } from "@/features/analytics/types";

const bucket = (start: string, value: number): TimeBucket => ({ start, value });

describe("alignSeries", () => {
  it("zips two series of equal length index by index", () => {
    const current = [bucket("2024-03-08T00:00:00.000Z", 5), bucket("2024-03-09T00:00:00.000Z", 7)];
    const previous = [bucket("2024-03-01T00:00:00.000Z", 2), bucket("2024-03-02T00:00:00.000Z", 3)];

    expect(alignSeries(current, previous)).toEqual([
      {
        index: 0,
        start: "2024-03-08T00:00:00.000Z",
        previousStart: "2024-03-01T00:00:00.000Z",
        current: 5,
        previous: 2,
      },
      {
        index: 1,
        start: "2024-03-09T00:00:00.000Z",
        previousStart: "2024-03-02T00:00:00.000Z",
        current: 7,
        previous: 3,
      },
    ]);
  });

  it("reads a missing previous bucket as zero", () => {
    // A period with no rows is genuinely zero, so the chart keeps its x-axis.
    const current = [bucket("2024-03-08T00:00:00.000Z", 5), bucket("2024-03-09T00:00:00.000Z", 7)];
    const aligned = alignSeries(current, [bucket("2024-03-01T00:00:00.000Z", 2)]);

    expect(aligned).toHaveLength(2);
    expect(aligned[1]).toEqual({
      index: 1,
      start: "2024-03-09T00:00:00.000Z",
      previousStart: null,
      current: 7,
      previous: 0,
    });
  });

  it("drops extra previous buckets, because the x-axis is the current period", () => {
    const aligned = alignSeries(
      [bucket("2024-03-08T00:00:00.000Z", 5)],
      [bucket("2024-03-01T00:00:00.000Z", 2), bucket("2024-03-02T00:00:00.000Z", 9)],
    );

    expect(aligned).toHaveLength(1);
    expect(aligned[0]?.previous).toBe(2);
  });

  it("produces nothing when the current period has no buckets", () => {
    expect(alignSeries([], [bucket("2024-03-01T00:00:00.000Z", 2)])).toEqual([]);
  });
});

describe("resolveAnalyticsRange", () => {
  it("buckets short windows by day and long windows by week", () => {
    expect(resolveAnalyticsRange("7d")).toEqual({ period: "7d", days: 7, bucket: "day", bucketCount: 7 });
    expect(resolveAnalyticsRange("30d")).toEqual({ period: "30d", days: 30, bucket: "day", bucketCount: 30 });
    expect(resolveAnalyticsRange("90d")).toEqual({ period: "90d", days: 90, bucket: "week", bucketCount: 13 });
  });

  it("agrees with the period metadata the UI labels itself with", () => {
    for (const period of ["7d", "30d", "90d"] as const) {
      const range = resolveAnalyticsRange(period);
      expect(range.days).toBe(PERIOD_META[period].days);
      expect(range.bucket).toBe(PERIOD_META[period].bucket);
    }
  });
});

describe("bucketStepMs", () => {
  it("is one day or one week in milliseconds", () => {
    expect(bucketStepMs("day")).toBe(86_400_000);
    expect(bucketStepMs("week")).toBe(7 * 86_400_000);
  });
});

describe("formatBucketLabel and formatBucketRange", () => {
  it("labels a bucket in UTC, so it matches the rows the SQL counted", () => {
    expect(formatBucketLabel("2024-03-04T00:00:00.000Z")).toBe("Mar 4");
    // Late UTC on the 4th is still the 4th, whatever the viewer's zone is.
    expect(formatBucketLabel("2024-03-04T23:30:00.000Z")).toBe("Mar 4");
  });

  it("shows a day bucket as one date and a week bucket as a span", () => {
    expect(formatBucketRange("2024-03-04T00:00:00.000Z", "day")).toBe("Mar 4");
    expect(formatBucketRange("2024-03-04T00:00:00.000Z", "week")).toBe("Mar 4 – Mar 10");
  });
});
