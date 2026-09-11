import { describe, expect, it } from "vitest";

import { formatDate, formatRelativeTime } from "@/lib/format/date";
import { formatCompactNumber, formatNumber, formatPercent, formatSignedPercent } from "@/lib/format/number";

const NOW = new Date("2026-09-11T12:00:00.000Z");

function ago(seconds: number): Date {
  return new Date(NOW.getTime() - seconds * 1000);
}

describe("formatRelativeTime", () => {
  it("picks the largest unit that still reads naturally", () => {
    expect(formatRelativeTime(ago(45), NOW)).toBe("45 seconds ago");
    expect(formatRelativeTime(ago(5 * 60), NOW)).toBe("5 minutes ago");
    expect(formatRelativeTime(ago(3 * 3600), NOW)).toBe("3 hours ago");
    expect(formatRelativeTime(ago(2 * 86400), NOW)).toBe("2 days ago");
    expect(formatRelativeTime(ago(30 * 86400), NOW)).toBe("4 weeks ago");
    expect(formatRelativeTime(ago(400 * 86400), NOW)).toMatch(/year/);
  });

  it("uses friendly wording for the common cases", () => {
    expect(formatRelativeTime(ago(86400), NOW)).toBe("yesterday");
    expect(formatRelativeTime(new Date(NOW.getTime() + 86400_000), NOW)).toBe("tomorrow");
    expect(formatRelativeTime(ago(7 * 86400), NOW)).toBe("last week");
  });

  it("accepts the ISO strings the API returns", () => {
    expect(formatRelativeTime(ago(120).toISOString(), NOW)).toBe("2 minutes ago");
  });
});

describe("formatDate", () => {
  it("renders a short, unambiguous date", () => {
    // Pinned to UTC so the assertion does not depend on the machine's timezone.
    expect(formatDate("2026-09-11T12:00:00.000Z", { timeZone: "UTC" })).toBe("Sep 11, 2026");
  });

  it("lets callers override the parts they need", () => {
    expect(formatDate("2026-09-11T12:00:00.000Z", { timeZone: "UTC", month: "long", day: undefined })).toContain("September");
  });
});

describe("number formatting", () => {
  it("keeps large numbers compact in dense UI", () => {
    expect(formatCompactNumber(999)).toBe("999");
    expect(formatCompactNumber(1234)).toBe("1.2K");
    expect(formatCompactNumber(1_500_000)).toBe("1.5M");
    expect(formatCompactNumber(0)).toBe("0");
  });

  it("groups digits in full numbers", () => {
    expect(formatNumber(1_234_567)).toBe("1,234,567");
  });

  it("formats percentages, signing deltas so direction is never ambiguous", () => {
    expect(formatPercent(60)).toBe("60%");
    expect(formatPercent(12.345, 1)).toBe("12.3%");
    expect(formatSignedPercent(5)).toBe("+5%");
    expect(formatSignedPercent(-5)).toBe("-5%");
    expect(formatSignedPercent(0)).toBe("0%");
  });
});
