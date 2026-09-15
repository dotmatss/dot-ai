import { describe, expect, it } from "vitest";
import { parsePlatformAuditFilters, parseOrganizationFilters, parseUserFilters } from "@/features/platform/filters";
describe("platform URL filters", () => {
  it("drops invalid dates and normalizes an inverted date range", () => {
    expect(parsePlatformAuditFilters({ from: "2026-02-31" }).from).toBeUndefined();
    expect(parsePlatformAuditFilters({ from: "2026-09-13", to: "2026-09-01" })).toMatchObject({ from: "2026-09-01", to: "2026-09-13" });
  });
  it("bounds search input and ignores unknown statuses", () => {
    expect(parseOrganizationFilters({ q: "x".repeat(300), status: "other", page: "-1" })).toMatchObject({ q: "x".repeat(200), status: undefined, page: 1 });
    expect(parseUserFilters({ state: "other" }).state).toBeUndefined();
  });
});
