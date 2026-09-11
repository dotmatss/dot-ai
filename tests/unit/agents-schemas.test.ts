import { describe, expect, it } from "vitest";

import { parseAgentFilters } from "@/features/agents/filters";
import {
  agentChatSchema,
  agentMemoryConfigSchema,
  agentMemoryFormSchema,
  agentOutputSchemaField,
  createAgentSchema,
  isJsonObjectText,
  updateAgentSchema,
} from "@/features/agents/schemas";

describe("createAgentSchema", () => {
  it("requires a reasonable name and trims input", () => {
    expect(createAgentSchema.safeParse({ name: "A" }).success).toBe(false);
    const result = createAgentSchema.safeParse({ name: "  Onboarding agent  ", description: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe("Onboarding agent");
  });
});

describe("updateAgentSchema", () => {
  it("rejects empty patches and accepts partial ones", () => {
    expect(updateAgentSchema.safeParse({}).success).toBe(false);
    expect(updateAgentSchema.safeParse({ status: "active" }).success).toBe(true);
  });

  it("validates nested model config bounds", () => {
    expect(updateAgentSchema.safeParse({ modelConfig: { model: null, temperature: 5, maxTokens: 1024 } }).success).toBe(false);
    expect(updateAgentSchema.safeParse({ modelConfig: { model: null, temperature: 0.2, maxTokens: 32 } }).success).toBe(false);
    expect(updateAgentSchema.safeParse({ modelConfig: { model: "balanced", temperature: 0.2, maxTokens: 2048 } }).success).toBe(true);
  });

  it("keeps the memory window inside its limits", () => {
    expect(agentMemoryConfigSchema.safeParse({ enabled: true, windowMessages: 1, summarize: false }).success).toBe(false);
    expect(agentMemoryConfigSchema.safeParse({ enabled: true, windowMessages: 201, summarize: false }).success).toBe(false);
    expect(agentMemoryConfigSchema.safeParse({ enabled: true, windowMessages: 20, summarize: true }).success).toBe(true);
  });

  it("parses the output schema from editor text and clears it on empty input", () => {
    const parsed = updateAgentSchema.safeParse({ outputSchema: '{"type":"object"}' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.outputSchema).toEqual({ type: "object" });

    const cleared = updateAgentSchema.safeParse({ outputSchema: "   " });
    expect(cleared.success).toBe(true);
    if (cleared.success) expect(cleared.data.outputSchema).toBeNull();
  });

  it("rejects an output schema that is not a JSON object", () => {
    expect(agentOutputSchemaField.safeParse("{oops").success).toBe(false);
    expect(agentOutputSchemaField.safeParse("[1,2,3]").success).toBe(false);
    expect(agentOutputSchemaField.safeParse('"a string"').success).toBe(false);
    expect(agentOutputSchemaField.safeParse(null).success).toBe(true);
  });

  it("rejects collection ids that are not uuids", () => {
    expect(updateAgentSchema.safeParse({ collectionIds: ["not-a-uuid"] }).success).toBe(false);
    expect(updateAgentSchema.safeParse({ collectionIds: ["7f9c0d3e-59a4-4c2e-9c1a-6b0f1d2e3a4b"] }).success).toBe(true);
  });
});

describe("agentMemoryFormSchema", () => {
  it("accepts empty schema text but rejects invalid JSON", () => {
    const base = { memoryEnabled: true, windowMessages: 20, summarize: false, requiresApproval: false };
    expect(agentMemoryFormSchema.safeParse({ ...base, outputSchemaText: "" }).success).toBe(true);
    expect(agentMemoryFormSchema.safeParse({ ...base, outputSchemaText: "{" }).success).toBe(false);
    expect(agentMemoryFormSchema.safeParse({ ...base, outputSchemaText: '{"type":"object"}' }).success).toBe(true);
  });
});

describe("agentChatSchema", () => {
  it("requires at least one non-empty message", () => {
    expect(agentChatSchema.safeParse({ messages: [] }).success).toBe(false);
    expect(agentChatSchema.safeParse({ messages: [{ role: "user", content: "   " }] }).success).toBe(false);
    expect(agentChatSchema.safeParse({ messages: [{ role: "user", content: "Summarize the last ticket" }] }).success).toBe(true);
  });

  it("rejects a conversation id that is not a uuid", () => {
    expect(agentChatSchema.safeParse({ conversationId: "abc", messages: [{ role: "user", content: "hi" }] }).success).toBe(false);
  });
});

describe("isJsonObjectText", () => {
  it("only accepts JSON objects", () => {
    expect(isJsonObjectText('{"a":1}')).toBe(true);
    expect(isJsonObjectText("[]")).toBe(false);
    expect(isJsonObjectText("null")).toBe(false);
    expect(isJsonObjectText("nope")).toBe(false);
  });
});

describe("parseAgentFilters", () => {
  it("normalizes URL params into filters shared with the server", () => {
    expect(parseAgentFilters({ q: " research ", status: "active", page: "3" })).toEqual({ q: "research", status: "active", page: 3, pageSize: 20 });
  });

  it("drops unknown statuses and clamps invalid pages", () => {
    expect(parseAgentFilters({ status: "bogus", page: "-1" })).toEqual({ q: undefined, status: undefined, page: 1, pageSize: 20 });
    expect(parseAgentFilters({ page: "abc" })).toEqual({ q: undefined, status: undefined, page: 1, pageSize: 20 });
  });

  it("takes the first value when a param repeats", () => {
    expect(parseAgentFilters({ status: ["paused", "active"], q: [" hi ", "x"] })).toEqual({
      q: "hi",
      status: "paused",
      page: 1,
      pageSize: 20,
    });
  });
});
