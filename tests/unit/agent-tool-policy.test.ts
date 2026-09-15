// @vitest-environment node
/**
 * The tool policy: what an agent turn may reach, regardless of how the agent
 * is configured.
 *
 * A workflow-started turn runs under `{ mcp: false }`. The claim worth testing
 * is not "MCP calls are refused" but something stronger: under that policy the
 * engine never loads an MCP bundle at all, and no MCP declaration reaches the
 * model. Refusal-on-call would leave a window; never-loaded does not.
 *
 * The engine's collaborators are mocked so this runs without a database or a
 * provider. The gateway stub records every request, which is how "no tools
 * were offered" is observed rather than inferred.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DELEGATION_DEFAULTS } from "@/features/agents/delegation-limits";
import type { Agent } from "@/features/agents/types";
import type { ChatStreamEvent } from "@/types/ai";

const loadAgentMcpContext = vi.hoisted(() => vi.fn());
const lifecycle = vi.hoisted(() => vi.fn());
vi.mock("@/server/auth/lifecycle", () => ({ assertWorkspaceActive: lifecycle, assertUserActive: lifecycle }));
const requests = vi.hoisted(() => [] as Array<{ messages: Array<{ role: string; content: string }>; tools?: unknown[] }>);

vi.mock("@/features/mcp/server/agent-mcp", () => ({
  loadAgentMcpContext,
  disabledAgentMcpContext: () => ({
    tools: [],
    definitions: [],
    refFor: () => null,
    resolve: (ref: string) => ({ status: "unknown_tool", toolRef: ref, serverId: null, toolName: ref, reason: "not a tool this agent may use" }),
    execute: async (call: { toolRef: string }) => ({
      callId: null,
      status: "refused",
      resolution: "unknown_tool",
      resultText: null,
      message: `“${call.toolRef}” is not a tool this agent may use.`,
      isError: false,
    }),
  }),
}));
vi.mock("@/features/knowledge/server/retrieval", () => ({ retrieveKnowledge: async () => [] }));
vi.mock("@/server/usage/record-usage", () => ({ recordUsageBatch: async () => undefined }));
vi.mock("@/features/conversations/server/conversation-repository", () => ({
  appendMessage: async () => undefined,
  createConversation: async () => ({ id: "conv-1" }),
  deriveConversationTitle: (text: string) => text,
  findConversation: async () => null,
}));
vi.mock("@/server/ai", () => ({
  getAiGateway: () => ({
    provider: "stub",
    async *streamChat(request: { messages: Array<{ role: string; content: string }>; tools?: unknown[] }): AsyncGenerator<ChatStreamEvent> {
      requests.push({ messages: request.messages, tools: request.tools });
      yield { type: "text-delta", delta: "answer" };
      yield { type: "usage", usage: { inputTokens: 7, outputTokens: 2 } };
      yield { type: "done", finishReason: "stop" };
    },
  }),
}));

const { startAgentTurn } = await import("@/features/agents/server/agent-engine");

/** An agent that HAS an MCP tool attached - the case the policy has to beat. */
function agentWithMcp(): Agent {
  return {
    id: "agent-1",
    workspaceId: "ws-1",
    name: "Finance Agent",
    description: null,
    status: "active",
    instructions: "Handle invoices.",
    modelConfig: { model: null, temperature: 0.2, maxTokens: 512 },
    tools: [],
    mcpTools: [{ source: "mcp", serverSlug: "crm", toolName: "create_invoice", enabled: true, requiresApproval: true }],
    memoryConfig: { enabled: true, windowMessages: 10, summarize: false },
    outputSchema: null,
    requiresApproval: false,
    canDelegate: false,
    delegateIds: [],
    delegateCount: 0,
    delegationConfig: { ...DELEGATION_DEFAULTS },
    collectionIds: [],
    collectionCount: 0,
    enabledToolCount: 0,
    conversationCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

async function run(options: { mcp?: boolean }) {
  const turn = await startAgentTurn({
    agent: agentWithMcp(),
    input: { messages: [{ role: "user", content: "Create the invoice." }] },
    signal: new AbortController().signal,
    transcript: "detached",
    ...(options.mcp === undefined ? {} : { toolPolicy: { mcp: options.mcp } }),
  });
  for await (const _event of turn.events) {
    // drained
  }
  return turn.finalize();
}

beforeEach(() => {
  lifecycle.mockReset().mockResolvedValue(undefined);
  loadAgentMcpContext.mockReset();
  requests.length = 0;
  loadAgentMcpContext.mockResolvedValue({
    tools: [
      {
        ref: "mcp.crm.create_invoice",
        serverSlug: "crm",
        serverName: "Acme CRM",
        toolName: "create_invoice",
        title: null,
        description: "Creates an invoice",
        inputSchema: { type: "object", properties: {} },
        riskClass: "write",
        requiresApproval: true,
      },
    ],
    definitions: [{ name: "mcp_crm_create_invoice", description: "Creates an invoice", parameters: { type: "object", properties: {} } }],
    refFor: (name: string) => (name === "mcp_crm_create_invoice" ? "mcp.crm.create_invoice" : null),
    resolve: () => ({ status: "resolved", toolRef: "mcp.crm.create_invoice", serverId: "s1", toolName: "create_invoice", reason: "" }),
    execute: async () => ({ callId: "c1", status: "executed", resolution: "resolved", resultText: "ok", message: "ok", isError: false }),
  });
});

describe("tool policy { mcp: false }", () => {
  it("stops suspended tenants before loading tools or calling the model", async () => {
    lifecycle.mockRejectedValue(new Error("Workspace unavailable"));
    await expect(run({ mcp: false })).rejects.toThrow("Workspace unavailable");
    expect(loadAgentMcpContext).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });
  it("never loads an MCP bundle", async () => {
    await run({ mcp: false });
    expect(loadAgentMcpContext).not.toHaveBeenCalled();
  });

  it("offers the model no tool declarations at all", async () => {
    await run({ mcp: false });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.tools).toBeUndefined();
  });

  it("describes no MCP tool in the system prompt", async () => {
    await run({ mcp: false });
    const system = requests[0]?.messages.find((message) => message.role === "system")?.content ?? "";
    expect(system).not.toContain("mcp.crm");
    expect(system).not.toContain("Acme CRM");
    expect(system).not.toContain("create_invoice");
  });

  it("still answers, on the agent's own instructions", async () => {
    const outcome = await run({ mcp: false });
    expect(outcome.text).toBe("answer");
    const system = requests[0]?.messages.find((message) => message.role === "system")?.content ?? "";
    expect(system).toContain("Handle invoices.");
  });
});

describe("the default policy", () => {
  it("loads the agent's MCP context and offers its tools - the behaviour every existing turn has", async () => {
    await run({});
    expect(loadAgentMcpContext).toHaveBeenCalledTimes(1);
    expect(requests[0]?.tools).toHaveLength(1);
    const system = requests[0]?.messages.find((message) => message.role === "system")?.content ?? "";
    expect(system).toContain("mcp.crm.create_invoice");
  });

  it("is what an explicit { mcp: true } means as well", async () => {
    await run({ mcp: true });
    expect(loadAgentMcpContext).toHaveBeenCalledTimes(1);
    expect(requests[0]?.tools).toHaveLength(1);
  });
});
