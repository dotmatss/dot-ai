import { describe, expect, it } from "vitest";

import { DOC_PAGES } from "@/features/docs/registry";
import { ENTITLEMENT_GROUPS, ENTITLEMENT_LABELS, PLANS, findPlan, pricingIsDraft } from "@/features/pricing/plans";
import { BILLING_INTERVALS, ENTITLEMENT_KEYS, hasUndecidedValues, isDraft } from "@/features/pricing/types";

describe("plan catalogue", () => {
  it("gives every plan a unique id, a name and a description", () => {
    const ids = PLANS.map((plan) => plan.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const plan of PLANS) {
      expect(plan.id).toMatch(/^[a-z0-9-]+$/);
      expect(plan.name.length, plan.id).toBeGreaterThan(2);
      expect(plan.description.length, plan.id).toBeGreaterThan(30);
      expect(plan.features.length, plan.id).toBeGreaterThan(1);
    }
  });

  it("resolves a plan by id and nothing else", () => {
    for (const plan of PLANS) expect(findPlan(plan.id)).toBe(plan);
    expect(findPlan("enterprise-platinum")).toBeUndefined();
  });

  it("prices every plan for every billing interval", () => {
    for (const plan of PLANS) {
      for (const interval of BILLING_INTERVALS) {
        expect(plan.price[interval], `${plan.id} ${interval}`).toBeDefined();
      }
    }
  });

  it("states a limit for every entitlement key, with no key left out", () => {
    for (const plan of PLANS) {
      for (const key of ENTITLEMENT_KEYS) {
        expect(plan.limits[key], `${plan.id} is missing ${key}`).toBeDefined();
      }
      expect(Object.keys(plan.limits).sort()).toEqual([...ENTITLEMENT_KEYS].sort());
    }
  });

  it("highlights at most one plan", () => {
    expect(PLANS.filter((plan) => plan.highlighted)).toHaveLength(1);
  });

  it("points every call to action at a route that exists", () => {
    const known = ["/sign-up", "/sign-in", "/pricing", "/docs"];
    for (const plan of PLANS) {
      expect(known, `${plan.id} call to action`).toContain(plan.cta.href);
      expect(plan.cta.label.length).toBeGreaterThan(4);
    }
  });

  it("links every feature to documentation that exists", () => {
    const slugs = new Set(DOC_PAGES.map((page) => `/docs/${page.slug}`));
    for (const plan of PLANS) {
      for (const feature of plan.features) {
        if (!feature.docsHref) continue;
        expect(slugs.has(feature.docsHref), `${plan.id}: ${feature.docsHref} has no documentation page`).toBe(true);
      }
    }
  });
});

describe("nothing is invented", () => {
  it("treats every plan as a draft while pricing is unsettled", () => {
    expect(PLANS.every(isDraft)).toBe(true);
    expect(pricingIsDraft()).toBe(true);
  });

  it("would drop the draft notice once the plans are published", () => {
    const published = PLANS.map((plan) => ({ ...plan, status: "published" as const }));
    expect(pricingIsDraft(published)).toBe(false);
  });

  it("leaves at least one value undecided on every plan that is not free", () => {
    const paid = PLANS.filter((plan) => plan.price.monthly.kind !== "free");
    expect(paid.length).toBeGreaterThan(0);
    for (const plan of paid) {
      expect(hasUndecidedValues(plan), `${plan.id} claims to be fully specified`).toBe(true);
    }
  });

  it("carries no numeric price anywhere in the catalogue", () => {
    // The price union has no amount field at all, so this cannot regress
    // quietly; the assertion documents why.
    const serialised = JSON.stringify(PLANS);
    expect(serialised).not.toMatch(/"amount"/);
    expect(serialised).not.toMatch(/[$£€]\s?\d/);
  });

  it("names no capability the product does not have", () => {
    // Every feature label must relate to something documented. The check is
    // deliberately blunt: it catches a plan that starts advertising SSO,
    // audit exports or an SLA before any of those exist.
    const forbidden = /\b(SSO|SAML|SCIM|audit log export|SLA|99\.9|dedicated instance|on-?premise|HIPAA|SOC ?2)\b/i;
    for (const plan of PLANS) {
      for (const feature of plan.features) {
        expect(feature.label, `${plan.id}: ${feature.label}`).not.toMatch(forbidden);
      }
      expect(plan.description, plan.id).not.toMatch(forbidden);
    }
  });

  it("promises no discount for paying yearly, because none has been decided", () => {
    const serialised = JSON.stringify(PLANS);
    expect(serialised).not.toMatch(/save \d|% off|\d+% cheaper/i);
  });
});

describe("pricing maps to product capabilities", () => {
  it("covers every entitlement key exactly once across the comparison groups", () => {
    const grouped = ENTITLEMENT_GROUPS.flatMap((group) => group.keys);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual([...ENTITLEMENT_KEYS].sort());
  });

  it("labels every entitlement key for display", () => {
    for (const key of ENTITLEMENT_KEYS) {
      expect(ENTITLEMENT_LABELS[key], key).toBeDefined();
      expect(ENTITLEMENT_LABELS[key].length).toBeGreaterThan(2);
    }
  });

  it("uses metered keys that match what usage_events already records", () => {
    // `usage_events.kind` already carries message, tokens_in, tokens_out and
    // workflow_run. The metered entitlements line up with those, so usage
    // limits can be enforced later without a second metering mechanism.
    expect(ENTITLEMENT_KEYS).toContain("messagesPerMonth");
    expect(ENTITLEMENT_KEYS).toContain("tokensPerMonth");
    expect(ENTITLEMENT_KEYS).toContain("workflowRunsPerMonth");
  });

  it("keeps entitlement keys free of pricing concerns", () => {
    // A key names a capability, never a tier. `proOnly` would couple the
    // product to a plan name and is exactly what requirement 9 forbids.
    for (const key of ENTITLEMENT_KEYS) {
      expect(key, `${key} names a plan rather than a capability`).not.toMatch(/free|starter|team|scale|pro|business/i);
    }
  });
});
