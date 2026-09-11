import { describe, expect, it } from "vitest";

import { CONVERSATION_FILTER_KEYS, hasActiveConversationFilters, parseConversationFilters } from "@/features/conversations/filters";

const CHATBOT_ID = "3f1d9c4e-7b2a-4f5c-8d6e-0a1b2c3d4e5f";
const AGENT_ID = "9a8b7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d";
const USER_ID = "11111111-2222-4333-8444-555555555555";

describe("parseConversationFilters", () => {
  it("normalizes URL params into the shape the server and client share", () => {
    expect(parseConversationFilters({ q: "  refund  ", status: "open", channel: "widget", page: "3" })).toEqual({
      q: "refund",
      status: "open",
      channel: "widget",
      chatbotId: undefined,
      agentId: undefined,
      contactId: undefined,
      assignedTo: undefined,
      page: 3,
      pageSize: 20,
    });
  });

  it("drops values outside the allowed sets instead of passing them to SQL", () => {
    const filters = parseConversationFilters({ status: "archived", channel: "sms", chatbotId: "not-a-uuid", page: "-2" });
    expect(filters.status).toBeUndefined();
    expect(filters.channel).toBeUndefined();
    expect(filters.chatbotId).toBeUndefined();
    expect(filters.page).toBe(1);
  });

  it("keeps the literal \"me\" and lower-cases uuids", () => {
    expect(parseConversationFilters({ assignedTo: "me" }).assignedTo).toBe("me");
    expect(parseConversationFilters({ assignedTo: USER_ID.toUpperCase() }).assignedTo).toBe(USER_ID);
    expect(parseConversationFilters({ assignedTo: "someone" }).assignedTo).toBeUndefined();
  });

  it("accepts the deep links the chatbot and agent overviews produce", () => {
    expect(parseConversationFilters({ chatbotId: CHATBOT_ID }).chatbotId).toBe(CHATBOT_ID);
    expect(parseConversationFilters({ agentId: AGENT_ID }).agentId).toBe(AGENT_ID);
  });

  it("takes the first value when a key repeats in the query string", () => {
    expect(parseConversationFilters({ status: ["resolved", "open"] }).status).toBe("resolved");
  });

  it("lets fixed filters win over the URL so an embedded inbox stays in context", () => {
    const filters = parseConversationFilters({ chatbotId: CHATBOT_ID, status: "open" }, { chatbotId: AGENT_ID });
    expect(filters.chatbotId).toBe(AGENT_ID);
    expect(filters.status).toBe("open");
  });

  it("ignores undefined entries in the fixed filters", () => {
    const filters = parseConversationFilters({ chatbotId: CHATBOT_ID }, { chatbotId: undefined, status: undefined });
    expect(filters.chatbotId).toBe(CHATBOT_ID);
  });
});

describe("hasActiveConversationFilters", () => {
  it("ignores pagination and reports only user-adjustable filters", () => {
    expect(hasActiveConversationFilters(parseConversationFilters({ page: "4" }))).toBe(false);
    expect(hasActiveConversationFilters(parseConversationFilters({ q: "refund" }))).toBe(true);
  });

  it("does not count a filter the host pinned, which has no control to clear", () => {
    const fixed = { chatbotId: CHATBOT_ID };
    expect(hasActiveConversationFilters(parseConversationFilters({}, fixed), fixed)).toBe(false);
    expect(hasActiveConversationFilters(parseConversationFilters({ status: "open" }, fixed), fixed)).toBe(true);
  });
});

describe("CONVERSATION_FILTER_KEYS", () => {
  it("covers every parameter the inbox writes back to the URL", () => {
    expect([...CONVERSATION_FILTER_KEYS]).toEqual(["q", "status", "channel", "chatbotId", "agentId", "contactId", "assignedTo", "page"]);
  });
});
