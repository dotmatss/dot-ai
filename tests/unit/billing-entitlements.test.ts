import { describe, expect, it } from "vitest";

import {
  METERED_ENTITLEMENT_KINDS,
  calendarMonthPeriod,
  isMeteredEntitlement,
} from "@/features/billing/constants";
import { isEnforced, noPlanCheck, resolveLimit, unknownPlanCheck } from "@/features/billing/entitlement-rules";
import { assignPlanSchema, planAssignmentFormSchema } from "@/features/billing/schemas";
import { ENTITLEMENT_REASONS, SUBSCRIPTION_STATUSES } from "@/features/billing/types";
import { PLANS } from "@/features/pricing/plans";
import { ENTITLEMENT_KEYS } from "@/features/pricing/types";

const KEY = "chatbots" as const;

// `noUncheckedIndexedAccess` is on, and an empty catalogue would make every
// assertion below vacuous rather than failing. Resolve it once, loudly.
const FIRST_PLAN = PLANS.at(0);
if (!FIRST_PLAN) throw new Error("The plan catalogue is empty");

describe("entitlement rules", () => {
  it("denies only an unavailable capability or a limit that has been reached", () => {
    expect(resolveLimit(KEY, { kind: "unavailable" }, null).allowed).toBe(false);
    expect(resolveLimit(KEY, { kind: "count", value: 3 }, 3).allowed).toBe(false);

    expect(resolveLimit(KEY, { kind: "included" }, null).allowed).toBe(true);
    expect(resolveLimit(KEY, { kind: "unlimited" }, null).allowed).toBe(true);
    expect(resolveLimit(KEY, { kind: "undecided" }, null).allowed).toBe(true);
    expect(resolveLimit(KEY, { kind: "custom", label: "Agreed" }, null).allowed).toBe(true);
    expect(resolveLimit(KEY, { kind: "count", value: 3 }, 2).allowed).toBe(true);
  });

  /**
   * The distinction the whole feature rests on: an undecided limit permits the
   * action WITHOUT claiming the plan grants it. A regression here would let a
   * page present an empty business model as a set of promises.
   */
  it("never reports an undecided limit as enforced", () => {
    const check = resolveLimit(KEY, { kind: "undecided" }, null);
    expect(check.allowed).toBe(true);
    expect(check.enforced).toBe(false);
    expect(check.reason).toBe("undecided");
  });

  it("treats a decided limit with no measurement as unverified rather than passing", () => {
    const check = resolveLimit(KEY, { kind: "count", value: 5 }, null);
    expect(check.reason).toBe("not_measured");
    expect(check.allowed).toBe(true);
    expect(check.enforced).toBe(false);
    expect(check.usage).toBeNull();
  });

  it("enforces a decided numeric limit in both directions", () => {
    const within = resolveLimit(KEY, { kind: "count", value: 5 }, 2);
    expect(within.reason).toBe("within_limit");
    expect(within.enforced).toBe(true);
    expect(within.usage).toEqual({ current: 2, limit: 5, remaining: 3 });

    const reached = resolveLimit(KEY, { kind: "count", value: 5 }, 5);
    expect(reached.reason).toBe("limit_reached");
    expect(reached.enforced).toBe(true);
    expect(reached.allowed).toBe(false);
  });

  it("clamps remaining at zero when a limit has been exceeded", () => {
    const over = resolveLimit(KEY, { kind: "count", value: 5 }, 8);
    expect(over.allowed).toBe(false);
    expect(over.usage).toEqual({ current: 8, limit: 5, remaining: 0 });
  });

  it("enforces nothing when no plan is in force or the plan is unknown", () => {
    for (const check of [noPlanCheck(KEY), unknownPlanCheck(KEY)]) {
      expect(check.allowed).toBe(true);
      expect(check.enforced).toBe(false);
    }
    expect(noPlanCheck(KEY).reason).toBe("no_plan");
    expect(unknownPlanCheck(KEY).reason).toBe("unknown_plan");
  });

  it("classifies every reason as enforced or not, with no reason left out", () => {
    for (const reason of ENTITLEMENT_REASONS) {
      expect(typeof isEnforced(reason), reason).toBe("boolean");
    }
    // "Allowed because nothing was decided" must never read as enforced.
    expect(ENTITLEMENT_REASONS.filter((reason) => !isEnforced(reason)).sort()).toEqual(
      ["agreed", "no_plan", "not_measured", "undecided", "unknown_plan"].sort(),
    );
  });
});

describe("metered entitlements", () => {
  it("maps every metered key to usage_events kinds and nothing else", () => {
    expect(Object.keys(METERED_ENTITLEMENT_KINDS).sort()).toEqual(
      ["messagesPerMonth", "tokensPerMonth", "workflowRunsPerMonth"].sort(),
    );
    for (const key of ENTITLEMENT_KEYS) {
      expect(isMeteredEntitlement(key), key).toBe(key in METERED_ENTITLEMENT_KINDS);
    }
  });

  it("counts both token directions against the token allowance", () => {
    expect(METERED_ENTITLEMENT_KINDS.tokensPerMonth).toEqual(["tokens_in", "tokens_out"]);
  });

  /** Half-open windows: consecutive months must not both claim the boundary instant. */
  it("builds a calendar month that starts on the first and ends on the next first", () => {
    const { start, end } = calendarMonthPeriod(new Date("2026-03-17T12:30:00.000Z"));
    expect(start.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });

  it("rolls the year over in December", () => {
    const { end } = calendarMonthPeriod(new Date("2026-12-09T00:00:00.000Z"));
    expect(end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("assignment schemas", () => {
  it("accepts every plan in the catalogue and rejects anything else", () => {
    for (const plan of PLANS) {
      expect(assignPlanSchema.safeParse({ planId: plan.id }).success, plan.id).toBe(true);
    }
    expect(assignPlanSchema.safeParse({ planId: "enterprise-platinum" }).success).toBe(false);
    expect(assignPlanSchema.safeParse({ planId: "" }).success).toBe(false);
  });

  it("defaults an assignment to active and not ending", () => {
    const parsed = assignPlanSchema.parse({ planId: FIRST_PLAN.id });
    expect(parsed.status).toBe("active");
    expect(parsed.cancelAtPeriodEnd).toBe(false);
  });

  it("refuses a period that has already ended", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(assignPlanSchema.safeParse({ planId: FIRST_PLAN.id, currentPeriodEnd: past }).success).toBe(false);

    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(assignPlanSchema.safeParse({ planId: FIRST_PLAN.id, currentPeriodEnd: future }).success).toBe(true);
  });

  it("accepts every subscription status", () => {
    for (const status of SUBSCRIPTION_STATUSES) {
      expect(assignPlanSchema.safeParse({ planId: FIRST_PLAN.id, status }).success, status).toBe(true);
    }
  });

  /** The form schema carries no defaults, so react-hook-form has one type to model. */
  it("requires every field in the form schema", () => {
    expect(planAssignmentFormSchema.safeParse({ planId: FIRST_PLAN.id }).success).toBe(false);
    expect(
      planAssignmentFormSchema.safeParse({ planId: FIRST_PLAN.id, status: "active", cancelAtPeriodEnd: false }).success,
    ).toBe(true);
  });
});
