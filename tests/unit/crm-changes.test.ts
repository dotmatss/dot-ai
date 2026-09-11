import { describe, expect, it } from "vitest";

import {
  describePropertyChange,
  describeTagChange,
  diffProperties,
  formatList,
  hasPropertyChange,
} from "@/features/crm/changes";
import { SUMMARY_MAX_ITEM_CHARS, SUMMARY_MAX_TRANSCRIPT_CHARS } from "@/features/crm/constants";
import { buildSummaryPrompt, type SummaryContact } from "@/features/crm/summary-prompt";

describe("formatList", () => {
  it("reads as a sentence", () => {
    expect(formatList([])).toBe("");
    expect(formatList(["name"])).toBe("name");
    expect(formatList(["name", "email"])).toBe("name and email");
    expect(formatList(["name", "email", "company"])).toBe("name, email and company");
  });
});

describe("describeTagChange", () => {
  it("describes additions and removals together", () => {
    expect(describeTagChange(["vip"], [])).toBe("Tags added “vip”");
    expect(describeTagChange([], ["beta"])).toBe("Tags removed “beta”");
    expect(describeTagChange(["vip", "eu"], ["beta"])).toBe("Tags added “vip” and “eu”, removed “beta”");
  });
});

describe("diffProperties", () => {
  it("separates added, updated and removed keys", () => {
    const diff = diffProperties({ plan: "pro", seats: "3" }, { plan: "enterprise", region: "eu" });
    expect(diff).toEqual({ added: ["region"], updated: ["plan"], removed: ["seats"] });
    expect(hasPropertyChange(diff)).toBe(true);
    expect(describePropertyChange(diff)).toBe("Properties added region, changed plan, removed seats");
  });

  it("reports no change when the maps match", () => {
    const diff = diffProperties({ plan: "pro" }, { plan: "pro" });
    expect(diff).toEqual({ added: [], updated: [], removed: [] });
    expect(hasPropertyChange(diff)).toBe(false);
  });
});

const contact: SummaryContact = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  company: "Acme",
  source: "widget",
  stage: "prospect",
};

describe("buildSummaryPrompt", () => {
  it("includes identity, notes and messages, labelled by origin", () => {
    const prompt = buildSummaryPrompt(contact, {
      notes: [{ body: "Wants a demo", authorName: "Grace" }],
      messages: [{ role: "user", content: "How much is the pro plan?" }, { role: "assistant", content: "It is $50." }],
    });
    expect(prompt).toContain("Contact: Ada Lovelace");
    expect(prompt).toContain("Stage: Prospect");
    expect(prompt).toContain("[note by Grace] Wants a demo");
    expect(prompt).toContain("[contact] How much is the pro plan?");
    expect(prompt).toContain("[assistant] It is $50.");
  });

  it("omits fields the contact does not have", () => {
    const prompt = buildSummaryPrompt({ ...contact, company: null, source: null }, { notes: [], messages: [] });
    expect(prompt).not.toContain("Company:");
    expect(prompt).not.toContain("Source:");
  });

  it("clips one long item instead of letting it fill the prompt", () => {
    const prompt = buildSummaryPrompt(contact, {
      notes: [{ body: "x".repeat(SUMMARY_MAX_ITEM_CHARS * 3), authorName: null }],
      messages: [],
    });
    expect(prompt).toContain("…");
    expect(prompt.length).toBeLessThan(SUMMARY_MAX_ITEM_CHARS * 2);
  });

  it("stays inside the transcript budget and keeps the newest material", () => {
    const notes = Array.from({ length: 40 }, (_, index) => ({
      body: `note-${index} ${"y".repeat(SUMMARY_MAX_ITEM_CHARS)}`,
      authorName: null,
    }));
    const prompt = buildSummaryPrompt(contact, { notes, messages: [] });
    expect(prompt.length).toBeLessThanOrEqual(SUMMARY_MAX_TRANSCRIPT_CHARS + 500);
    expect(prompt).toContain("note-0");
    expect(prompt).not.toContain("note-39");
  });
});
