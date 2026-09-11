import { describe, expect, it } from "vitest";

import { parseWorkflowFilters, parseWorkflowRunFilters } from "@/features/workflows/filters";
import { formatDuration } from "@/features/workflows/format";
import {
  createWorkflowSchema,
  runInputSchema,
  startWorkflowRunSchema,
  updateWorkflowSchema,
  workflowListQuerySchema,
  workflowRunListQuerySchema,
} from "@/features/workflows/schemas";
import { durationMs } from "@/features/workflows/types";

describe("parseWorkflowFilters", () => {
  it("normalizes URL params into filters shared with the server", () => {
    expect(parseWorkflowFilters({ q: " leads ", status: "active", page: "3" })).toEqual({
      q: "leads",
      status: "active",
      page: 3,
      pageSize: 20,
    });
  });

  it("drops unknown statuses and invalid pages", () => {
    expect(parseWorkflowFilters({ status: "bogus", page: "-2" })).toEqual({
      q: undefined,
      status: undefined,
      page: 1,
      pageSize: 20,
    });
    expect(parseWorkflowFilters({ q: ["first", "second"] }).q).toBe("first");
  });
});

describe("parseWorkflowRunFilters", () => {
  it("uses its own URL keys so run and workflow lists can coexist", () => {
    expect(parseWorkflowRunFilters({ runStatus: "failed", runPage: "2", page: "9" })).toEqual({
      status: "failed",
      page: 2,
      pageSize: 20,
    });
    expect(parseWorkflowRunFilters({ runStatus: "nope" }).status).toBeUndefined();
  });
});

describe("createWorkflowSchema", () => {
  it("requires a name and defaults to the blank template", () => {
    expect(createWorkflowSchema.safeParse({ name: "A" }).success).toBe(false);
    const parsed = createWorkflowSchema.parse({ name: "  Lead qualifier  " });
    expect(parsed).toEqual({ name: "Lead qualifier", template: "blank" });
  });

  it("rejects unknown templates", () => {
    expect(createWorkflowSchema.safeParse({ name: "Valid name", template: "custom" }).success).toBe(false);
  });
});

describe("updateWorkflowSchema", () => {
  it("rejects empty patches", () => {
    expect(updateWorkflowSchema.safeParse({}).success).toBe(false);
  });

  it("accepts partial patches and validates the nested definition", () => {
    expect(updateWorkflowSchema.safeParse({ status: "active" }).success).toBe(true);
    expect(updateWorkflowSchema.safeParse({ description: null }).success).toBe(true);
    expect(
      updateWorkflowSchema.safeParse({
        definition: { nodes: [{ id: "t", type: "trigger.manual", label: "Start", config: {} }], edges: [] },
      }).success,
    ).toBe(true);
    expect(updateWorkflowSchema.safeParse({ definition: { nodes: [{ id: "t" }], edges: [] } }).success).toBe(false);
  });
});

describe("list query schemas", () => {
  it("apply pagination defaults and bounds", () => {
    expect(workflowListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(workflowListQuerySchema.parse({ page: "2", pageSize: "5", q: " x " })).toMatchObject({ page: 2, pageSize: 5, q: "x" });
    expect(workflowListQuerySchema.safeParse({ pageSize: "1000" }).success).toBe(false);
    expect(workflowRunListQuerySchema.parse({ status: "succeeded" })).toEqual({ page: 1, pageSize: 20, status: "succeeded" });
  });
});

describe("startWorkflowRunSchema", () => {
  it("defaults the input to an empty object", () => {
    expect(startWorkflowRunSchema.parse({})).toEqual({ input: {} });
  });

  it("keeps arbitrary input values but rejects oversized payloads", () => {
    expect(startWorkflowRunSchema.parse({ input: { email: "ada@example.com", seats: 4 } }).input).toEqual({
      email: "ada@example.com",
      seats: 4,
    });
    const huge = { input: { blob: "x".repeat(21_000) } };
    expect(startWorkflowRunSchema.safeParse(huge).success).toBe(false);
  });
});

describe("runInputSchema", () => {
  it("requires every declared field", () => {
    const schema = runInputSchema(["email", "company"]);
    expect(schema.safeParse({ email: "a@b.co", company: "Acme" }).success).toBe(true);
    expect(schema.safeParse({ email: "a@b.co", company: "  " }).success).toBe(false);
    expect(runInputSchema([]).safeParse({}).success).toBe(true);
  });
});

describe("duration helpers", () => {
  it("computes and formats elapsed time", () => {
    expect(durationMs("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:02.500Z")).toBe(2500);
    expect(durationMs(null, "2026-01-01T00:00:02.500Z")).toBeNull();
    expect(durationMs("2026-01-01T00:00:02.500Z", "2026-01-01T00:00:00.000Z")).toBeNull();
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(420)).toBe("420ms");
    expect(formatDuration(2500)).toBe("2.5s");
    expect(formatDuration(95_000)).toBe("1m 35s");
  });
});
