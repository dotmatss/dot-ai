import { describe, expect, it } from "vitest";

import { AUDIT_PAGE_SIZE, actionLabel, entityTypeLabel, humanize } from "@/features/audit/constants";
import { hasAuditFilters, parseAuditFilters } from "@/features/audit/filters";

/**
 * The URL is the source of truth for these filters, which means the parser is
 * fed hand-edited and stale links as a matter of course. Every branch below is
 * "render something sensible" rather than "reject": a 500 on a bookmarked
 * search is a worse outcome than an unfiltered list.
 */

describe("parseAuditFilters", () => {
  it("returns an unfiltered first page for no parameters", () => {
    const filters = parseAuditFilters({});
    expect(filters).toMatchObject({ page: 1, pageSize: AUDIT_PAGE_SIZE });
    expect(hasAuditFilters(filters)).toBe(false);
  });

  it("keeps the filters it recognises", () => {
    const filters = parseAuditFilters({
      q: "  invited  ",
      actorId: "3F1C0E2A-1111-4222-8333-444455556666",
      entityType: "mcp_tool_call",
      action: "mcp.tool_call.approved",
      from: "2026-09-01",
      to: "2026-09-13",
      page: "3",
    });
    expect(filters).toEqual({
      q: "invited",
      actorId: "3f1c0e2a-1111-4222-8333-444455556666",
      entityType: "mcp_tool_call",
      action: "mcp.tool_call.approved",
      from: "2026-09-01",
      to: "2026-09-13",
      page: 3,
      pageSize: AUDIT_PAGE_SIZE,
    });
    expect(hasAuditFilters(filters)).toBe(true);
  });

  it("drops values it cannot trust rather than failing", () => {
    const filters = parseAuditFilters({
      actorId: "not-a-uuid",
      entityType: "drop table users",
      action: "'; DELETE FROM activity_log; --",
      from: "13/09/2026",
      to: "2026-02-31", // shaped like a date, but no such day
      page: "-4",
    });
    expect(filters.actorId).toBeUndefined();
    expect(filters.entityType).toBeUndefined();
    expect(filters.action).toBeUndefined();
    expect(filters.from).toBeUndefined();
    expect(filters.to).toBeUndefined();
    expect(filters.page).toBe(1);
  });

  // An inverted range matches nothing, which looks like a broken page rather
  // than a mistyped URL.
  it("swaps an inverted date range", () => {
    const filters = parseAuditFilters({ from: "2026-09-30", to: "2026-09-01" });
    expect(filters.from).toBe("2026-09-01");
    expect(filters.to).toBe("2026-09-30");
  });

  it("takes the first value when a key repeats", () => {
    expect(parseAuditFilters({ entityType: ["chatbot", "agent"] }).entityType).toBe("chatbot");
  });

  it("bounds a long search term", () => {
    expect(parseAuditFilters({ q: "x".repeat(500) }).q).toHaveLength(200);
  });
});

describe("labels", () => {
  it("expands acronyms and separators", () => {
    expect(humanize("mcp_tool_call")).toBe("MCP tool call");
    expect(humanize("api_key")).toBe("API key");
    expect(humanize("role:admin")).toBe("Role: admin");
  });

  it("falls back to the raw value for anything unmapped", () => {
    // entity_type and action are free text: a feature that writes a new value
    // without touching the audit feature must still render.
    expect(entityTypeLabel("chatbot")).toBe("Chatbot");
    expect(entityTypeLabel("something_new")).toBe("Something new");
    expect(actionLabel("reprocessed")).toBe("Reprocessed");
  });
});
