import { describe, expect, it } from "vitest";

import { parseChatbotFilters } from "@/features/chatbots/filters";
import { allowedDomainSchema, createChatbotSchema, updateChatbotSchema } from "@/features/chatbots/schemas";

describe("allowedDomainSchema", () => {
  it("normalizes URLs to hostnames and accepts wildcards", () => {
    expect(allowedDomainSchema.parse("https://WWW.Example.com/pricing")).toBe("www.example.com");
    expect(allowedDomainSchema.parse("*.example.com")).toBe("*.example.com");
    expect(allowedDomainSchema.parse("localhost:3000")).toBe("localhost:3000");
  });

  it("rejects invalid hostnames", () => {
    expect(allowedDomainSchema.safeParse("not a domain").success).toBe(false);
    expect(allowedDomainSchema.safeParse("example").success).toBe(false);
  });
});

describe("createChatbotSchema", () => {
  it("requires a reasonable name", () => {
    expect(createChatbotSchema.safeParse({ name: "A" }).success).toBe(false);
    expect(createChatbotSchema.safeParse({ name: "Support bot", description: "" }).success).toBe(true);
  });
});

describe("updateChatbotSchema", () => {
  it("rejects empty patches and accepts partial ones", () => {
    expect(updateChatbotSchema.safeParse({}).success).toBe(false);
    const result = updateChatbotSchema.safeParse({ status: "active", allowedDomains: ["Example.com"] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.allowedDomains).toEqual(["example.com"]);
  });

  it("validates nested model config", () => {
    expect(updateChatbotSchema.safeParse({ modelConfig: { model: null, temperature: 5, maxTokens: 100 } }).success).toBe(false);
  });
});

describe("parseChatbotFilters", () => {
  it("normalizes URL params into filters shared with the server", () => {
    expect(parseChatbotFilters({ q: " hello ", status: "active", page: "3" })).toEqual({ q: "hello", status: "active", page: 3, pageSize: 20 });
    expect(parseChatbotFilters({ status: "bogus", page: "-1" })).toEqual({ q: undefined, status: undefined, page: 1, pageSize: 20 });
  });
});
