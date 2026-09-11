import { describe, expect, it } from "vitest";

import { selectMemoryWindow } from "@/features/agents/memory";
import { agentToolSettingsSchema, updateAgentSchema } from "@/features/agents/schemas";
import {
  AGENT_TOOL_LIST,
  AGENT_TOOLS,
  defaultToolSetting,
  normalizeToolSettings,
  resolveAgentToolCall,
  toolSettingsForForm,
} from "@/features/agents/tools/registry";
import { AGENT_TOOL_IDS } from "@/features/agents/types";

describe("agent tool registry", () => {
  it("describes every declared tool id exactly once, in order", () => {
    expect(AGENT_TOOL_LIST.map((tool) => tool.id)).toEqual([...AGENT_TOOL_IDS]);
  });

  it("has a default config that satisfies its own config schema", () => {
    for (const tool of AGENT_TOOL_LIST) {
      const parsed = tool.configSchema.safeParse(tool.defaultConfig);
      expect(parsed.success, `${tool.id} default config`).toBe(true);
    }
  });

  it("renders a form field for every configurable key", () => {
    for (const tool of AGENT_TOOL_LIST) {
      const fieldKeys = tool.configFields.map((field) => field.key).sort();
      expect(fieldKeys, `${tool.id} config fields`).toEqual(Object.keys(tool.defaultConfig).sort());
    }
  });

  it("requires approval by default for tools with side effects outside the workspace", () => {
    expect(AGENT_TOOLS.http_request.requiresApprovalByDefault).toBe(true);
    expect(AGENT_TOOLS.run_workflow.requiresApprovalByDefault).toBe(true);
    expect(AGENT_TOOLS.send_email.requiresApprovalByDefault).toBe(true);
    expect(AGENT_TOOLS.web_search.requiresApprovalByDefault).toBe(false);
  });
});

describe("agentToolSettingsSchema", () => {
  it("accepts a known tool and fills the config defaults", () => {
    const result = agentToolSettingsSchema.safeParse([{ toolId: "web_search", enabled: true }]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0]).toEqual({ toolId: "web_search", enabled: true, config: { maxResults: 5, region: "global" }, requiresApproval: false });
    }
  });

  it("defaults requiresApproval from the registry when the client omits it", () => {
    const result = agentToolSettingsSchema.safeParse([{ toolId: "send_email", enabled: true }]);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data[0]?.requiresApproval).toBe(true);
  });

  it("rejects unknown tool ids", () => {
    const result = agentToolSettingsSchema.safeParse([{ toolId: "drop_database", enabled: true, config: {} }]);
    expect(result.success).toBe(false);
  });

  it("rejects config that fails the tool's own schema and reports the field path", () => {
    const result = agentToolSettingsSchema.safeParse([{ toolId: "web_search", enabled: true, config: { maxResults: 99 } }]);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual([0, "config", "maxResults"]);
    }
  });

  it("rejects a malformed URL for the HTTP tool but accepts an empty one", () => {
    expect(agentToolSettingsSchema.safeParse([{ toolId: "http_request", enabled: true, config: { baseUrl: "not a url" } }]).success).toBe(false);
    expect(agentToolSettingsSchema.safeParse([{ toolId: "http_request", enabled: true, config: { baseUrl: "" } }]).success).toBe(true);
  });

  it("rejects a workflow id that is not a uuid", () => {
    expect(agentToolSettingsSchema.safeParse([{ toolId: "run_workflow", enabled: true, config: { workflowId: "wf-1" } }]).success).toBe(false);
  });

  it("rejects the same tool configured twice", () => {
    const result = agentToolSettingsSchema.safeParse([
      { toolId: "web_search", enabled: true },
      { toolId: "web_search", enabled: false },
    ]);
    expect(result.success).toBe(false);
  });

  it("is reachable through the update payload", () => {
    expect(updateAgentSchema.safeParse({ tools: [{ toolId: "knowledge_search", enabled: true }] }).success).toBe(true);
    expect(updateAgentSchema.safeParse({ tools: [{ toolId: "nope", enabled: true }] }).success).toBe(false);
  });
});

describe("normalizeToolSettings", () => {
  it("drops unknown ids and repairs invalid stored config", () => {
    const settings = normalizeToolSettings([
      { toolId: "gone_tool", enabled: true },
      { toolId: "web_search", enabled: true, config: { maxResults: 99 } },
      "junk",
      null,
    ]);
    expect(settings).toEqual([{ toolId: "web_search", enabled: true, config: { maxResults: 5, region: "global" }, requiresApproval: false }]);
  });

  it("returns an empty list for anything that is not an array", () => {
    expect(normalizeToolSettings(null)).toEqual([]);
    expect(normalizeToolSettings({ toolId: "web_search" })).toEqual([]);
  });

  it("keeps the last entry when a tool repeats and preserves registry order", () => {
    const settings = normalizeToolSettings([
      { toolId: "send_email", enabled: false },
      { toolId: "web_search", enabled: true },
      { toolId: "send_email", enabled: true },
    ]);
    expect(settings.map((setting) => setting.toolId)).toEqual(["web_search", "send_email"]);
    expect(settings.find((setting) => setting.toolId === "send_email")?.enabled).toBe(true);
  });
});

describe("toolSettingsForForm", () => {
  it("fills every registry tool, keeping saved values", () => {
    const rows = toolSettingsForForm([{ toolId: "send_email", enabled: true, config: { maxPerTurn: 3 }, requiresApproval: false }]);
    expect(rows).toHaveLength(AGENT_TOOL_IDS.length);
    expect(rows.find((row) => row.toolId === "send_email")).toEqual({
      toolId: "send_email",
      enabled: true,
      config: { maxPerTurn: 3 },
      requiresApproval: false,
    });
    expect(rows.find((row) => row.toolId === "web_search")).toEqual(defaultToolSetting("web_search"));
  });
});

describe("resolveAgentToolCall", () => {
  const enabled = [
    { toolId: "web_search" as const, enabled: true, config: {}, requiresApproval: false },
    { toolId: "send_email" as const, enabled: true, config: {}, requiresApproval: true },
    { toolId: "http_request" as const, enabled: false, config: {}, requiresApproval: true },
  ];

  it("simulates a known, enabled tool that needs no approval", () => {
    const result = resolveAgentToolCall({ name: "web_search", tools: enabled, agentRequiresApproval: false });
    expect(result.status).toBe("simulated");
    expect(result.toolId).toBe("web_search");
  });

  it("asks for approval when the tool requires it", () => {
    expect(resolveAgentToolCall({ name: "send_email", tools: enabled, agentRequiresApproval: false }).status).toBe("approval_required");
  });

  it("asks for approval for every call when the agent requires it", () => {
    expect(resolveAgentToolCall({ name: "web_search", tools: enabled, agentRequiresApproval: true }).status).toBe("approval_required");
  });

  it("reports a known tool that is not enabled", () => {
    expect(resolveAgentToolCall({ name: "http_request", tools: enabled, agentRequiresApproval: false }).status).toBe("unavailable");
  });

  it("reports a tool the platform does not have", () => {
    const result = resolveAgentToolCall({ name: "delete_everything", tools: enabled, agentRequiresApproval: false });
    expect(result.status).toBe("unknown_tool");
    expect(result.toolId).toBe("delete_everything");
  });

  it("always explains itself", () => {
    for (const name of ["web_search", "send_email", "http_request", "made_up"]) {
      expect(resolveAgentToolCall({ name, tools: enabled, agentRequiresApproval: false }).reason.length).toBeGreaterThan(0);
    }
  });
});

describe("selectMemoryWindow", () => {
  const transcript = [
    { role: "user" as const, content: "one" },
    { role: "assistant" as const, content: "two" },
    { role: "user" as const, content: "three" },
    { role: "assistant" as const, content: "four" },
    { role: "user" as const, content: "five" },
  ];

  it("sends only the latest user message when memory is off", () => {
    expect(selectMemoryWindow(transcript, { enabled: false, windowMessages: 20, summarize: false })).toEqual([{ role: "user", content: "five" }]);
  });

  it("keeps the most recent messages inside the window", () => {
    const window = selectMemoryWindow(transcript, { enabled: true, windowMessages: 2, summarize: false });
    expect(window).toEqual([
      { role: "assistant", content: "four" },
      { role: "user", content: "five" },
    ]);
  });

  it("prepends a summary of dropped messages when summarizing", () => {
    const window = selectMemoryWindow(transcript, { enabled: true, windowMessages: 2, summarize: true });
    expect(window).toHaveLength(3);
    expect(window[0]?.role).toBe("system");
    expect(window[0]?.content).toContain("3 earlier messages");
  });

  it("does not summarize when nothing was dropped", () => {
    const window = selectMemoryWindow(transcript, { enabled: true, windowMessages: 50, summarize: true });
    expect(window).toHaveLength(transcript.length);
    expect(window.every((message) => message.role !== "system")).toBe(true);
  });

  it("handles an empty transcript", () => {
    expect(selectMemoryWindow([], { enabled: true, windowMessages: 10, summarize: true })).toEqual([]);
  });
});
