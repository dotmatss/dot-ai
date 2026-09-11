import "server-only";

import { selectMemoryWindow } from "@/features/agents/memory";
import type { AgentChatInput } from "@/features/agents/schemas";
import { buildAgentSystemPrompt } from "@/features/agents/server/prompt";
import { resolveAgentToolCall, type ResolvedAgentToolCall } from "@/features/agents/tools/registry";
import type { Agent, AgentToolCallRecord, AgentToolCallStatus, AgentToolResultPayload } from "@/features/agents/types";
import { loadAgentMcpContext } from "@/features/mcp/server/agent-mcp";
import { isMcpToolRef } from "@/features/mcp/tool-ref";
import type { McpCallStatus, McpToolResolution } from "@/features/mcp/types";
import { MCP_LIMITS } from "@/features/mcp/constants";
import { appendMessage, createConversation, deriveConversationTitle, findConversation } from "@/features/conversations/server/conversation-repository";
import { retrieveKnowledge } from "@/features/knowledge/server/retrieval";
import { ApiError } from "@/lib/api/api-error";
import { getAiGateway } from "@/server/ai";
import { eventsToSseResponse } from "@/server/ai/sse";
import { recordUsageBatch } from "@/server/usage/record-usage";
import type { ChatMessage, ChatStreamEvent, RetrievedSource, TokenUsage } from "@/types/ai";

/**
 * Maps an MCP resolution onto the agent tool-call vocabulary.
 *
 * MCP distinguishes more ways a call can be refused than the built-in registry
 * can express - never granted, granted but not attached to this agent, granted
 * but since redefined, server unreachable - and to the transcript they all mean
 * the same thing: it did not run. The precise reason is preserved in the
 * message rather than flattened away.
 */
function toAgentToolCall(resolution: McpToolResolution): ResolvedAgentToolCall {
  const status: AgentToolCallStatus =
    resolution.status === "approval_required"
      ? "approval_required"
      : resolution.status === "unknown_tool"
        ? "unknown_tool"
        : resolution.status === "resolved"
          ? "simulated"
          : "unavailable";
  return { toolId: resolution.toolRef, status, reason: resolution.reason };
}

/**
 * Maps an execution outcome onto the agent tool-call vocabulary.
 *
 * `running` cannot be observed here (execution always resolves past it), but
 * it is mapped rather than defaulted so a future caller of this function
 * cannot silently report an in-flight call as finished.
 */
function statusForOutcome(status: McpCallStatus): AgentToolCallStatus {
  switch (status) {
    case "executed":
      return "executed";
    case "awaiting_approval":
      return "approval_required";
    case "failed":
    case "denied":
    case "expired":
    case "running":
      return "unavailable";
    case "refused":
      return "unavailable";
  }
}

interface RunAgentChatOptions {
  agent: Agent;
  input: AgentChatInput;
  signal: AbortSignal;
  /** The person whose turn this is, recorded against any tool call it makes. */
  userId?: string | null;
  metadata?: Record<string, string>;
}

/**
 * Executes one agent turn end-to-end and returns an SSE response: persist the
 * user message, retrieve knowledge, stream the model, resolve any tool calls
 * against the registry, then persist the assistant reply, the tool decisions
 * and token usage.
 *
 * Built-in tool calls are never executed: the agent is allowed to *ask*, and
 * the pipeline records the request and reports why it did not run.
 *
 * MCP tool calls DO execute, and they are the only ones that do. They are the
 * only tool path with a per-tool grant made by a person, a content-hash pin on
 * the definition that person approved, a risk classification and an approval
 * gate — so they are the only ones where "run it" is a decision somebody
 * actually made. Every call is re-checked at the point of use and recorded in
 * `mcp_tool_calls`, refusals included. See `features/mcp/server/mcp-execution.ts`.
 *
 * A pass that executes a tool feeds the result back and runs another
 * completion, bounded by `MCP_LIMITS.maxCallsPerTurn`.
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

  const sources = await retrieveKnowledge(workspaceId, agent.collectionIds, lastUser.content).catch(() => [] as RetrievedSource[]);

  // Loaded once per turn: the tools the agent may offer, the declarations that
  // make them callable, and the execution path. The MCP feature owns all three.
  const mcp = await loadAgentMcpContext({
    workspaceId,
    attachments: agent.mcpTools,
    agentRequiresApproval: agent.requiresApproval,
    agentId: agent.id,
    conversationId,
    requestedBy: options.userId ?? null,
  });

  const history: ChatMessage[] = [
    { role: "system", content: buildAgentSystemPrompt(agent, mcp.tools) },
    ...selectMemoryWindow(input.messages, agent.memoryConfig),
  ];

  const gateway = getAiGateway();

  let assistantText = "";
  let usage: TokenUsage | null = null;
  let emittedSources: RetrievedSource[] = sources;
  const toolCalls: AgentToolCallRecord[] = [];

  const withToolResolution = (async function* (): AsyncIterable<ChatStreamEvent> {
    // Let the client learn the conversation id first so follow-ups can continue it.
    yield { type: "tool-result", id: "conversation", result: { conversationId } };

    let executed = 0;

    // Each pass is one completion. A pass that executes a tool feeds the result
    // back and runs another, because a tool result the model never sees is a
    // tool call that achieved nothing. Bounded twice over: by the number of
    // passes and by the number of calls actually made.
    for (let pass = 0; pass <= MCP_LIMITS.maxCallsPerTurn; pass++) {
      const requested: Array<{ id: string; name: string; arguments: unknown }> = [];
      let passText = "";
      let finished: ChatStreamEvent | null = null;

      const events = gateway.streamChat({
        model: agent.modelConfig.model ?? undefined,
        messages: history,
        temperature: agent.modelConfig.temperature,
        maxTokens: agent.modelConfig.maxTokens,
        // Sources ground the first pass; re-sending them on every pass would
        // re-emit the citations the client already has.
        ...(pass === 0 ? { sources } : {}),
        ...(mcp.definitions.length > 0 ? { tools: mcp.definitions } : {}),
        signal,
        metadata: { workspaceId, agentId: agent.id, channel: "agent", ...options.metadata },
      });

      for await (const event of events) {
        if (event.type === "tool-call") {
          requested.push({ id: event.id, name: event.name, arguments: event.arguments });
          continue;
        }
        if (event.type === "text-delta") passText += event.delta;
        // `done` is held back: an intermediate pass is not the end of the turn.
        if (event.type === "done") {
          finished = event;
          continue;
        }
        yield event;
      }

      if (requested.length === 0) {
        yield finished ?? { type: "done", finishReason: "stop" };
        return;
      }

      // The assistant's own turn has to be replayed with the calls it made, or
      // the provider will reject the results that answer them.
      history.push({
        role: "assistant",
        content: passText,
        toolCalls: requested.map((call) => ({ id: call.id, name: call.name, arguments: call.arguments })),
      });

      let fedBack = 0;

      for (const call of requested) {
        const ref = mcp.refFor(call.name);

        if (ref === null) {
          // Not an MCP tool: the built-in registry decides, and nothing runs.
          const resolution = isMcpToolRef(call.name)
            ? toAgentToolCall(mcp.resolve(call.name))
            : resolveAgentToolCall({
                name: call.name,
                tools: agent.tools,
                agentRequiresApproval: agent.requiresApproval,
              });
          toolCalls.push({
            id: call.id,
            toolId: resolution.toolId,
            arguments: call.arguments,
            status: resolution.status,
            message: resolution.reason,
          });
          const payload: AgentToolResultPayload = { ...resolution, arguments: call.arguments };
          yield { type: "tool-result", id: call.id, result: payload };
          history.push({ role: "tool", toolCallId: call.id, content: resolution.reason });
          continue;
        }

        if (executed >= MCP_LIMITS.maxCallsPerTurn) {
          const message = `This turn has already used its ${MCP_LIMITS.maxCallsPerTurn} tool calls.`;
          toolCalls.push({ id: call.id, toolId: ref, arguments: call.arguments, status: "unavailable", message });
          yield { type: "tool-result", id: call.id, result: { toolId: ref, status: "unavailable", reason: message, arguments: call.arguments } };
          history.push({ role: "tool", toolCallId: call.id, content: message });
          continue;
        }

        executed += 1;
        const outcome = await mcp.execute({ toolRef: ref, arguments: call.arguments, signal });
        const status = statusForOutcome(outcome.status);

        toolCalls.push({
          id: call.id,
          toolId: ref,
          arguments: call.arguments,
          status,
          message: outcome.message,
          ...(outcome.resultText === null ? {} : { result: outcome.resultText }),
        });
        yield {
          type: "tool-result",
          id: call.id,
          result: { toolId: ref, status, reason: outcome.message, arguments: call.arguments } satisfies AgentToolResultPayload,
        };

        // Only a real result goes back to the model. A refusal goes back as the
        // reason, so it can explain itself rather than silently retrying.
        history.push({ role: "tool", toolCallId: call.id, content: outcome.resultText ?? outcome.message });
        if (outcome.resultText !== null) fedBack += 1;
      }

      if (fedBack === 0) {
        // Nothing ran, so another pass would produce the same refusals.
        yield finished ?? { type: "done", finishReason: "stop" };
        return;
      }
    }

    yield { type: "done", finishReason: "stop" };
  })();

  return eventsToSseResponse(withToolResolution, {
    signal,
    onEvent: (event) => {
      if (event.type === "text-delta") assistantText += event.delta;
      // Summed, not replaced: a turn that calls a tool runs more than one
      // completion, and billing the last one only would under-report it.
      else if (event.type === "usage") {
        usage = usage
          ? {
              inputTokens: usage.inputTokens + event.usage.inputTokens,
              outputTokens: usage.outputTokens + event.usage.outputTokens,
            }
          : event.usage;
      } else if (event.type === "sources") emittedSources = event.sources;
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
