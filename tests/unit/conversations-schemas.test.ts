import { describe, expect, it } from "vitest";

import {
  contactSearchQuerySchema,
  conversationListQuerySchema,
  humanReplySchema,
  updateConversationSchema,
} from "@/features/conversations/schemas";

const USER_ID = "11111111-2222-4333-8444-555555555555";

describe("conversationListQuerySchema", () => {
  it("applies pagination defaults and coerces numeric strings", () => {
    const parsed = conversationListQuerySchema.parse({ page: "2", pageSize: "50" });
    expect(parsed).toMatchObject({ page: 2, pageSize: 50 });
    expect(conversationListQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 20 });
  });

  it("caps the page size so one request cannot ask for the whole inbox", () => {
    expect(conversationListQuerySchema.safeParse({ pageSize: "500" }).success).toBe(false);
  });

  it("accepts both assignee forms and rejects anything else", () => {
    expect(conversationListQuerySchema.parse({ assignedTo: "me" }).assignedTo).toBe("me");
    expect(conversationListQuerySchema.parse({ assignedTo: USER_ID }).assignedTo).toBe(USER_ID);
    expect(conversationListQuerySchema.safeParse({ assignedTo: "everyone" }).success).toBe(false);
  });

  it("rejects unknown status and channel values", () => {
    expect(conversationListQuerySchema.safeParse({ status: "archived" }).success).toBe(false);
    expect(conversationListQuerySchema.safeParse({ channel: "sms" }).success).toBe(false);
  });
});

describe("updateConversationSchema", () => {
  it("rejects an empty patch", () => {
    expect(updateConversationSchema.safeParse({}).success).toBe(false);
  });

  it("accepts a single field and keeps null as an explicit clear", () => {
    expect(updateConversationSchema.parse({ status: "resolved" })).toEqual({ status: "resolved" });
    expect(updateConversationSchema.parse({ assignedTo: null })).toEqual({ assignedTo: null });
    expect(updateConversationSchema.parse({ contactId: null })).toEqual({ contactId: null });
  });

  it("requires ids to be uuids", () => {
    expect(updateConversationSchema.safeParse({ assignedTo: "me" }).success).toBe(false);
    expect(updateConversationSchema.safeParse({ contactId: "42" }).success).toBe(false);
  });
});

describe("contactSearchQuerySchema", () => {
  it("requires a term and defaults the limit", () => {
    expect(contactSearchQuerySchema.safeParse({ q: "  " }).success).toBe(false);
    expect(contactSearchQuerySchema.parse({ q: " ada " })).toEqual({ q: "ada", limit: 8 });
  });

  it("bounds the limit", () => {
    expect(contactSearchQuerySchema.safeParse({ q: "ada", limit: "100" }).success).toBe(false);
  });
});

describe("humanReplySchema", () => {
  it("trims and rejects empty replies", () => {
    expect(humanReplySchema.parse({ content: "  On it  " }).content).toBe("On it");
    expect(humanReplySchema.safeParse({ content: "   " }).success).toBe(false);
  });

  it("rejects replies past the stored length budget", () => {
    expect(humanReplySchema.safeParse({ content: "x".repeat(8001) }).success).toBe(false);
  });
});
