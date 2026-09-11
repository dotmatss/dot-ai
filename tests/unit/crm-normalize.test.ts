import { describe, expect, it } from "vitest";

import { MAX_CUSTOM_PROPERTIES, MAX_TAG_LENGTH, MAX_TAGS_PER_CONTACT } from "@/features/crm/constants";
import {
  contactAvatarSeed,
  contactDisplayName,
  isValidPropertyKey,
  normalizeEmail,
  normalizeProperties,
  normalizeTag,
  normalizeTags,
} from "@/features/crm/normalize";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
  });

  it("treats blank input as absent", () => {
    expect(normalizeEmail("   ")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });
});

describe("normalizeTag", () => {
  it("lowercases and collapses internal whitespace", () => {
    expect(normalizeTag("  Enterprise   Lead ")).toBe("enterprise lead");
  });

  it("caps the length and leaves no trailing space", () => {
    const tag = normalizeTag(`${"a".repeat(MAX_TAG_LENGTH - 1)} bbbb`);
    expect(tag.length).toBeLessThanOrEqual(MAX_TAG_LENGTH);
    expect(tag).toBe(tag.trim());
  });
});

describe("normalizeTags", () => {
  it("de-duplicates case-insensitively and keeps first-seen order", () => {
    expect(normalizeTags([" VIP ", "beta", "vip", "Beta"])).toEqual(["vip", "beta"]);
  });

  it("drops empty entries", () => {
    expect(normalizeTags(["", "   ", "vip"])).toEqual(["vip"]);
  });

  it("caps the number of tags", () => {
    const many = Array.from({ length: MAX_TAGS_PER_CONTACT + 5 }, (_, index) => `tag-${index}`);
    expect(normalizeTags(many)).toHaveLength(MAX_TAGS_PER_CONTACT);
  });

  it("handles missing input", () => {
    expect(normalizeTags(null)).toEqual([]);
    expect(normalizeTags(undefined)).toEqual([]);
  });
});

describe("isValidPropertyKey", () => {
  it.each(["plan", "Plan Tier", "renewal_date", "seat-count", "q3 2026"])("accepts %s", (key) => {
    expect(isValidPropertyKey(key)).toBe(true);
  });

  it.each(["", "   ", "_leading", "-leading", "email@", "a".repeat(41)])("rejects %s", (key) => {
    expect(isValidPropertyKey(key)).toBe(false);
  });
});

describe("normalizeProperties", () => {
  it("trims keys and values", () => {
    expect(normalizeProperties({ "  plan  ": "  pro  " })).toEqual({ plan: "pro" });
  });

  it("renders non-string jsonb values as text instead of dropping them", () => {
    expect(normalizeProperties({ seats: 12, trial: false, meta: { a: 1 } })).toEqual({
      seats: "12",
      trial: "false",
      meta: '{"a":1}',
    });
  });

  it("drops invalid keys and null values rather than failing the whole record", () => {
    expect(normalizeProperties({ "bad key!": "x", plan: "pro", empty: null })).toEqual({ plan: "pro" });
  });

  it("caps the number of properties", () => {
    const many = Object.fromEntries(Array.from({ length: MAX_CUSTOM_PROPERTIES + 5 }, (_, i) => [`key${i}`, "v"]));
    expect(Object.keys(normalizeProperties(many))).toHaveLength(MAX_CUSTOM_PROPERTIES);
  });

  it("handles missing input", () => {
    expect(normalizeProperties(null)).toEqual({});
  });
});

describe("display helpers", () => {
  it("prefers the name, then the email", () => {
    expect(contactDisplayName({ name: "Ada", email: "ada@example.com" })).toBe("Ada");
    expect(contactDisplayName({ name: "  ", email: "ada@example.com" })).toBe("ada@example.com");
    expect(contactDisplayName({ name: null, email: null })).toBe("Unnamed contact");
  });

  it("derives avatar initials from the email local part when there is no name", () => {
    expect(contactAvatarSeed({ name: null, email: "ada.lovelace@example.com" })).toBe("ada lovelace");
    expect(contactAvatarSeed({ name: "Ada Lovelace", email: "x@y.co" })).toBe("Ada Lovelace");
    expect(contactAvatarSeed({ name: null, email: null })).toBe("Unnamed contact");
  });
});
