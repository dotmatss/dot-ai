import "server-only";

import { selectMemoryWindow } from "@/features/agents/memory";
import type { AgentChatInput } from "@/features/agents/schemas";
import { buildAgentSystemPrompt } from "@/features/agents/server/prompt";
import { resolveAgentToolCall } from "@/features/agents/tools/registry";
import type { Agent, AgentToolCallRecord, AgentToolResultPayload } from "@/features/agents/types";
import { appendMessage, createConversation, deriveConversationTitle, findConversation } from "@/features/conversations/server/conversation-repository";
import { retrieveKnowledge } from "@/features/knowledge/server/retrieval";
import { ApiError } from "@/lib/api/api-error";
import { getAiGateway } from "@/server/ai";
import { eventsToSseResponse } from "@/server/ai/sse";
import { recordUsageBatch } from "@/server/usage/record-usage";
import type { ChatMessage, ChatStreamEvent, RetrievedSource, TokenUsage } from "@/types/ai";

interface RunAgentChatOptions {
  agent: Agent;
  input: AgentChatInput;
  signal: AbortSignal;
  metadata?: Record<string, string>;
}

/**
 * Executes one agent turn end-to-end and returns an SSE response: persist the
 * user message, retrieve knowledge, stream the model, resolve any tool calls
 * against the registry, then persist the assistant reply, the tool decisions
 * and token usage.
 *
 * Tool calls are never executed here. Agents are allowed to *ask* for a tool;
 * running one would perform side effects (email, CRM writes, workflow runs)
 * outside the request that a human has not approved, so the pipeline records
 * the request and reports back why it did not run.
 */
export async function runAgentChat(options: RunAgentChatOptions): Promise<Response> {
  const { agent, input, signal } = options;
  const workspaceId = agent.workspaceId;
  const lastUser = [...input.messages].reverse().find((message) => message.role === "user");
  if (!lastUser) throw ApiError.badRequest("A user message is required");

  let conversationId = input.conversationId ?? null;
  if (conversationId) {
    const existing = await findConversation(workspaceId, conversationId);
    if (!existing || existing.agentId !== agent.id) throw ApiError.notFound("Conversation not found");
  } else {
    const created = await createConversation({
      workspaceId,
      agentId: agent.id,
      channel: "agent",
      title: deriveConversationTitle(lastUser.content),
    });
    conversationId = created.id;
  }

  await appendMessage({ workspaceId, conversationId, role: "user", content: lastUser.content });

  const sources = await retrieveKnowledge(workspaceId, agent.knowledgeBaseIds, lastUser.content).catch(() => [] as RetrievedSource[]);

  const messages: ChatMessage[] = [
    { role: "system", content: buildAgentSystemPrompt(agent) },
    ...selectMemoryWindow(input.messages, agent.memoryConfig),
  ];

  const gateway = getAiGateway();
  const events = gateway.streamChat({
    model: agent.modelConfig.model ?? undefined,
    messages,
    temperature: agent.modelConfig.temperature,
    maxTokens: agent.modelConfig.maxTokens,
    sources,
    signal,
    metadata: { workspaceId, agentId: agent.id, channel: "agent", ...options.metadata },
  });

  let assistantText = "";
  let usage: TokenUsage | null = null;
  let emittedSources: RetrievedSource[] = sources;
  const toolCalls: AgentToolCallRecord[] = [];

  const withToolResolution = (async function* (): AsyncIterable<ChatStreamEvent> {
    // Let the client learn the conversation id first so follow-ups can continue it.
    yield { type: "tool-result", id: "conversation", result: { conversationId } };
    for await (const event of events) {
      if (event.type !== "tool-call") {
        yield event;
        continue;
      }
      const resolution = resolveAgentToolCall({
        name: event.name,
        tools: agent.tools,
        agentRequiresApproval: agent.requiresApproval,
      });
      const payload: AgentToolResultPayload = { ...resolution, arguments: event.arguments };
      toolCalls.push({
        id: event.id,
        toolId: resolution.toolId,
        arguments: event.arguments,
        status: resolution.status,
        message: resolution.reason,
      });
      yield { type: "tool-result", id: event.id, result: payload };
    }
  })();

  return eventsToSseResponse(withToolResolution, {
    signal,
    onEvent: (event) => {
      if (event.type === "text-delta") assistantText += event.delta;
      else if (event.type === "usage") usage = event.usage;
      else if (event.type === "sources") emittedSources = event.sources;
    },
    onFinish: async () => {
      if (!conversationId) return;
      try {
        if (assistantText.trim() || toolCalls.length > 0) {
          await appendMessage({
            workspaceId,
            conversationId,
            role: "assistant",
            content: assistantText,
            sources: emittedSources.length > 0 ? emittedSources : null,
            toolCalls: toolCalls.length > 0 ? toolCalls : null,
            usage,
          });
        }
        const usageEvents: Array<{ kind: "message" | "tokens_in" | "tokens_out"; quantity: number; refType: string; refId: string }> = [
          { kind: "message", quantity: 1, refType: "agent", refId: agent.id },
        ];
        if (usage) {
          const resolved: TokenUsage = usage;
          usageEvents.push({ kind: "tokens_in", quantity: resolved.inputTokens, refType: "agent", refId: agent.id });
          usageEvents.push({ kind: "tokens_out", quantity: resolved.outputTokens, refType: "agent", refId: agent.id });
        }
        await recordUsageBatch(workspaceId, usageEvents);
      } catch (error) {
        console.error("[agents] failed to persist assistant turn", error);
      }
    },
  });
}
