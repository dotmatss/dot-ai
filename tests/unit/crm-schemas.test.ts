import { describe, expect, it } from "vitest";

import { MAX_CUSTOM_PROPERTIES, MAX_TAGS_PER_CONTACT } from "@/features/crm/constants";
import {
  contactFormSchema,
  contactListQuerySchema,
  contactPropertiesSchema,
  contactSubListQuerySchema,
  createContactNoteSchema,
  createContactSchema,
  updateContactSchema,
} from "@/features/crm/schemas";

describe("createContactSchema", () => {
  it("normalizes the email and blank optional fields to null", () => {
    const parsed = createContactSchema.parse({ name: "  Ada  ", email: " Ada@Example.COM ", phone: "", company: "  " });
    expect(parsed).toMatchObject({ name: "Ada", email: "ada@example.com", phone: null, company: null });
  });

  it("requires a name or an email address, reported on the name field", () => {
    const result = createContactSchema.safeParse({ phone: "+1 555 0100" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["name"]);
  });

  it("accepts an email-only contact", () => {
    expect(createContactSchema.safeParse({ email: "ada@example.com" }).success).toBe(true);
  });

  it("rejects a malformed email", () => {
    const result = createContactSchema.safeParse({ name: "Ada", email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("normalizes tags through the shared rules", () => {
    const parsed = createContactSchema.parse({ name: "Ada", tags: [" VIP ", "vip", "Beta"] });
    expect(parsed.tags).toEqual(["vip", "beta"]);
  });

  it("rejects more tags than the cap allows", () => {
    const tags = Array.from({ length: MAX_TAGS_PER_CONTACT + 1 }, (_, i) => `tag-${i}`);
    expect(createContactSchema.safeParse({ name: "Ada", tags }).success).toBe(false);
  });

  it("leaves untouched fields absent so a caller can tell 'unset' from 'clear'", () => {
    const parsed = createContactSchema.parse({ name: "Ada" });
    expect("company" in parsed).toBe(false);
  });
});

describe("updateContactSchema", () => {
  it("rejects an empty patch", () => {
    expect(updateContactSchema.safeParse({}).success).toBe(false);
  });

  it("allows clearing a field with null", () => {
    expect(updateContactSchema.parse({ company: null })).toEqual({ company: null });
  });

  it("accepts a properties map", () => {
    expect(updateContactSchema.parse({ properties: { plan: "pro" } })).toEqual({ properties: { plan: "pro" } });
  });
});

describe("contactPropertiesSchema", () => {
  it("trims keys and values", () => {
    expect(contactPropertiesSchema.parse({ "  plan ": "  pro " })).toEqual({ plan: "pro" });
  });

  it("rejects keys outside the allowed character set", () => {
    expect(contactPropertiesSchema.safeParse({ "plan!": "pro" }).success).toBe(false);
  });

  it("rejects more entries than the cap allows", () => {
    const many = Object.fromEntries(Array.from({ length: MAX_CUSTOM_PROPERTIES + 1 }, (_, i) => [`key${i}`, "v"]));
    expect(contactPropertiesSchema.safeParse(many).success).toBe(false);
  });
});

describe("contactFormSchema", () => {
  const base = { name: "Ada", email: "", phone: "", company: "", stage: "lead" as const, tags: [] };

  it("accepts an empty optional email", () => {
    expect(contactFormSchema.safeParse(base).success).toBe(true);
  });

  it("lowercases a supplied email", () => {
    expect(contactFormSchema.parse({ ...base, email: " Ada@Example.COM " }).email).toBe("ada@example.com");
  });

  it("requires a name or an email", () => {
    const result = contactFormSchema.safeParse({ ...base, name: "" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["name"]);
  });

  it("rejects an unknown stage", () => {
    expect(contactFormSchema.safeParse({ ...base, stage: "customer!" }).success).toBe(false);
  });
});

describe("createContactNoteSchema", () => {
  it("requires a non-blank body", () => {
    expect(createContactNoteSchema.safeParse({ body: "   " }).success).toBe(false);
    expect(createContactNoteSchema.parse({ body: "  Wants a demo  " }).body).toBe("Wants a demo");
  });
});

describe("list query schemas", () => {
  it("applies defaults and coerces numbers", () => {
    expect(contactListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(contactListQuerySchema.parse({ page: "3", pageSize: "50" })).toMatchObject({ page: 3, pageSize: 50 });
  });

  it("lowercases the tag filter so it matches stored tags", () => {
    expect(contactListQuerySchema.parse({ tag: " VIP " }).tag).toBe("vip");
  });

  it("rejects an unknown stage and an out-of-range page size", () => {
    expect(contactListQuerySchema.safeParse({ stage: "unknown" }).success).toBe(false);
    expect(contactListQuerySchema.safeParse({ pageSize: "500" }).success).toBe(false);
    expect(contactSubListQuerySchema.safeParse({ page: "0" }).success).toBe(false);
  });
});
