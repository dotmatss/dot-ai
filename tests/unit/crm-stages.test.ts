import { describe, expect, it } from "vitest";

import { CONTACT_ACTIVITY_LABELS, CONTACT_ACTIVITY_TYPES, CONTACT_STAGE_META, CONTACT_STAGE_ORDER } from "@/features/crm/constants";
import { contactStageSchema } from "@/features/crm/schemas";
import { CONTACT_STAGES } from "@/features/crm/types";

describe("contact stages", () => {
  it("describes every stage", () => {
    for (const stage of CONTACT_STAGES) {
      const meta = CONTACT_STAGE_META[stage];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.description.length).toBeGreaterThan(0);
      expect(meta.tone.length).toBeGreaterThan(0);
    }
  });

  it("orders stages along the lifecycle and covers them all exactly once", () => {
    expect(CONTACT_STAGE_ORDER).toEqual(["lead", "prospect", "customer", "churned"]);
    expect([...CONTACT_STAGE_ORDER].sort()).toEqual([...CONTACT_STAGES].sort());
  });

  it("keeps tones distinct enough to be meaningful, never as the only signal", () => {
    // Every stage still renders its label, so this only guards against two
    // stages sharing a tone and looking identical at a glance.
    const tones = CONTACT_STAGE_ORDER.map((stage) => CONTACT_STAGE_META[stage].tone);
    expect(new Set(tones).size).toBe(tones.length);
  });

  it("validates stage values at the boundary", () => {
    expect(contactStageSchema.safeParse("prospect").success).toBe(true);
    expect(contactStageSchema.safeParse("Prospect").success).toBe(false);
    expect(contactStageSchema.safeParse("unknown").success).toBe(false);
  });
});

describe("contact activity types", () => {
  it("labels every type this feature writes", () => {
    for (const type of CONTACT_ACTIVITY_TYPES) {
      expect(CONTACT_ACTIVITY_LABELS[type]).toBeTruthy();
    }
  });
});
