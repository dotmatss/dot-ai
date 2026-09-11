// @vitest-environment node
import { describe, expect, it } from "vitest";

import { likePattern, normalizePage, ParamBuilder, toIso, toIsoRequired, toPaginated } from "@/server/db/sql";

describe("normalizePage", () => {
  it("defaults to the first page", () => {
    expect(normalizePage({})).toEqual({ page: 1, pageSize: 20, offset: 0 });
  });

  it("computes the offset from the requested page", () => {
    expect(normalizePage({ page: 3, pageSize: 25 })).toEqual({ page: 3, pageSize: 25, offset: 50 });
  });

  it("clamps hostile input so a request cannot ask for the whole table", () => {
    expect(normalizePage({ page: 0, pageSize: 0 })).toEqual({ page: 1, pageSize: 1, offset: 0 });
    expect(normalizePage({ page: -5, pageSize: 100_000 }).pageSize).toBe(100);
    expect(normalizePage({ page: -5 }).page).toBe(1);
    expect(normalizePage({ page: 2.7, pageSize: 10.9 })).toEqual({ page: 2, pageSize: 10, offset: 10 });
  });
});

describe("toPaginated", () => {
  it("returns the envelope the client expects", () => {
    expect(toPaginated(["a", "b"], 42, { page: 2, pageSize: 2 })).toEqual({
      items: ["a", "b"],
      total: 42,
      page: 2,
      pageSize: 2,
    });
  });
});

describe("likePattern", () => {
  it("wraps the term for a contains match", () => {
    expect(likePattern("support")).toBe("%support%");
  });

  it("escapes wildcards so user input cannot widen the match", () => {
    // Without escaping, "%" would match every row.
    expect(likePattern("100%")).toBe("%100\\%%");
    expect(likePattern("a_b")).toBe("%a\\_b%");
    expect(likePattern("back\\slash")).toBe("%back\\\\slash%");
  });
});

describe("ParamBuilder", () => {
  it("hands out sequential placeholders that line up with its values", () => {
    const params = new ParamBuilder();
    const clauses = [
      `workspace_id = ${params.add("ws-1")}`,
      `status = ${params.add("active")}`,
      `name ILIKE ${params.add(likePattern("bot"))}`,
    ];

    expect(clauses).toEqual(["workspace_id = $1", "status = $2", "name ILIKE $3"]);
    expect(params.values).toEqual(["ws-1", "active", "%bot%"]);
  });

  it("keeps repeated values as separate parameters", () => {
    const params = new ParamBuilder();
    expect([params.add("x"), params.add("x")]).toEqual(["$1", "$2"]);
    expect(params.values).toHaveLength(2);
  });
});

describe("timestamp mapping", () => {
  it("converts database timestamps to ISO strings for the client", () => {
    const date = new Date("2026-09-11T04:05:06.000Z");
    expect(toIsoRequired(date)).toBe("2026-09-11T04:05:06.000Z");
    expect(toIso(date)).toBe("2026-09-11T04:05:06.000Z");
    expect(toIsoRequired("2026-09-11T04:05:06.000Z")).toBe("2026-09-11T04:05:06.000Z");
  });

  it("preserves null so optional timestamps stay optional", () => {
    expect(toIso(null)).toBeNull();
  });
});
