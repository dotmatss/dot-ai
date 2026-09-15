import { assertWorkspaceActive, assertUserActive } from "@/server/auth/lifecycle";
import "server-only";

import { selectMemoryWindow } from "@/features/agents/memory";
import type { AgentChatInput } from "@/features/agents/schemas";
import { buildAgentSystemPrompt } from "@/features/agents/server/prompt";
import { resolveAgentToolCall, type ResolvedAgentToolCall } from "@/features/agents/tools/registry";
import type { Agent, AgentToolCallRecord, AgentToolCallStatus, AgentToolResultPayload } from "@/features/agents/types";
import { disabledAgentMcpContext, loadAgentMcpContext } from "@/features/mcp/server/agent-mcp";
import { isMcpToolRef } from "@/features/mcp/tool-ref";
import type { McpCallStatus, McpToolResolution } from "@/features/mcp/types";
import { MCP_LIMITS } from "@/features/mcp/constants";
import { appendMessage, createConversation, deriveConversationTitle, findConversation } from "@/features/conversations/server/conversation-repository";
import { retrieveKnowledge } from "@/features/knowledge/server/retrieval";
import { ApiError } from "@/lib/api/api-error";
import { getAiGateway } from "@/server/ai";
import { recordUsageBatch } from "@/server/usage/record-usage";
import type { AiToolDefinition, ChatMessage, ChatStreamEvent, RetrievedSource, TokenUsage } from "@/types/ai";

/**
 * The one agent execution engine.
 *
 * Everything an agent turn is - knowledge retrieval, the system prompt, the
 * multi-pass completion loop, built-in tool resolution, MCP execution,
 * delegation, transcript persistence and usage accounting - happens here, once.
 * Two thin adapters consume it:
 *
 *   `runAgentChat`       streams it to a client as SSE (the playground, the API)
 *   `executeAgentTask`   collects it into a value (a supervisor's child call)
 *
 * There is deliberately no second executor. The rules about what a tool may do,
 * when a call stops for a person and what is fed back to the model are security
 * decisions, and two implementations of a security decision eventually disagree.
 *
 * Built-in tool calls are still never executed: the agent is allowed to *ask*,
 * and the pipeline records the request and reports why it did not run. MCP
 * calls DO execute and are re-checked at the point of use. Delegation executes
 * a *child agent*, never a tool of the child's - see `delegation.ts`.
 */

/** Maps an MCP resolution onto the agent tool-call vocabulary. */
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

/**
 * Delegation, as the engine sees it.
 *
 * Only an interface here. The implementation lives in `delegation.ts`, which
 * calls back into this engine to run the child - so the dependency points one
 * way and the engine never imports the delegation machinery.
 */
export interface AgentDelegationContext {
  /** Tool declarations to offer the model. Empty when delegation is unavailable. */
  definitions: AiToolDefinition[];
  isDelegationTool(name: string): boolean;
  /** Validates arguments, grants and limits. Never throws, never runs anything. */
  prepare(args: unknown): DelegationPlan;
  /** Runs a plan that `prepare` authorized. Never throws. */
  run(plan: AuthorizedDelegation, signal: AbortSignal): Promise<DelegationOutcome>;
}

export interface AuthorizedDelegation {
  ok: true;
  childAgentId: string;
  childAgentName: string;
  task: string;
  context: string | null;
}

export type DelegationPlan = AuthorizedDelegation | { ok: false; status: AgentToolCallStatus; reason: string };

export interface DelegationOutcome {
  /** The child's answer, to feed back to the supervisor. Null when nothing ran. */
  resultText: string | null;
  /** Transcript line. Never internal state, never the child's prompt. */
  message: string;
  status: AgentToolCallStatus;
  /** The child asked for something that stopped for a person. */
  requiresApproval: boolean;
}

export interface AgentTurnOptions {
  agent: Agent;
  input: AgentChatInput;
  signal: AbortSignal;
  /** The person whose turn this is, recorded against any MCP tool call it makes. */
  userId?: string | null;
  metadata?: Record<string, string>;
  /**
   * `"conversation"` finds or creates a conversation and persists both messages
   * - what every user-facing turn does. `"detached"` persists no messages at
   * all, for a delegated child whose output belongs to its execution row rather
   * than to the user's thread; `conversationId` is then used only to attribute
   * the child's MCP audit rows to the conversation that caused them.
   */
  transcript?: "conversation" | "detached";
  conversationId?: string | null;
  delegation?: AgentDelegationContext;
  /**
   * What this turn may reach, regardless of what the agent is configured with.
   * The default is everything the agent has. A workflow-started turn passes
   * `{ mcp: false }`: the agent runs on its instructions, knowledge and
   * built-in (simulated) tools, and no MCP declaration reaches the model at
   * all - a workflow can be reached from outside, and this is the line that
   * keeps it from becoming an indirect route to a customer's MCP servers.
   */
  toolPolicy?: AgentToolPolicy;
}

export interface AgentToolPolicy {
  mcp: boolean;
}

export const FULL_TOOL_POLICY: AgentToolPolicy = { mcp: true };

export interface AgentTurnOutcome {
  conversationId: string | null;
  text: string;
  usage: TokenUsage | null;
  toolCalls: AgentToolCallRecord[];
  /** Any tool this turn asked for is waiting on a person. */
  requiresApproval: boolean;
  sources: RetrievedSource[];
}

export interface AgentTurn {
  conversationId: string | null;
  /** Accumulates as it is consumed; drain it fully before calling `finalize`. */
  events: AsyncIterable<ChatStreamEvent>;
  /** Persists the transcript and meters usage. Safe to call exactly once. */
  finalize(): Promise<AgentTurnOutcome>;
}

/**
 * Prepares one agent turn and returns its event stream plus a finalizer.
 *
 * Nothing is persisted and no completion is requested until the events are
 * consumed, so an adapter decides how the turn is delivered without changing
 * what the turn does.
 */
export async function startAgentTurn(options: AgentTurnOptions): Promise<AgentTurn> {
  const { agent, input, signal, delegation } = options;
  const transcript = options.transcript ?? "conversation";
  const workspaceId = agent.workspaceId;
  await assertWorkspaceActive(workspaceId);
  if (options.userId) await assertUserActive(options.userId);
  const lastUser = [...input.messages].reverse().find((message) => message.role === "user");
  if (!lastUser) throw ApiError.badRequest("A user message is required");

  let conversationId = input.conversationId ?? options.conversationId ?? null;

  if (transcript === "conversation") {
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
  }

  const sources = await retrieveKnowledge(workspaceId, agent.collectionIds, lastUser.content).catch(() => [] as RetrievedSource[]);

  // Loaded once per turn: the tools the agent may offer, the declarations that
  // make them callable, and the execution path. The MCP feature owns all three.
  // Under a policy that forbids MCP nothing is loaded: not "loaded and hidden",
  // because a bundle that is never fetched cannot leak by a later mistake.
  const toolPolicy = options.toolPolicy ?? FULL_TOOL_POLICY;
  const mcp = toolPolicy.mcp
    ? await loadAgentMcpContext({
        workspaceId,
        attachments: agent.mcpTools,
        agentRequiresApproval: agent.requiresApproval,
        agentId: agent.id,
        conversationId,
        requestedBy: options.userId ?? null,
      })
    : disabledAgentMcpContext();

  const history: ChatMessage[] = [
    { role: "system", content: buildAgentSystemPrompt(agent, mcp.tools) },
    ...selectMemoryWindow(input.messages, agent.memoryConfig),
  ];

  const gateway = getAiGateway();
  const definitions: AiToolDefinition[] = [...mcp.definitions, ...(delegation?.definitions ?? [])];

  const state: AgentTurnOutcome = {
    conversationId,
    text: "",
    usage: null,
    toolCalls: [],
    requiresApproval: false,
    sources,
  };

  const produce = async function* (): AsyncIterable<ChatStreamEvent> {
    // Let the client learn the conversation id first so follow-ups can continue
    // it. A detached turn has no thread for anyone to continue.
    if (transcript === "conversation") {
      yield { type: "tool-result", id: "conversation", result: { conversationId } };
    }

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
        ...(definitions.length > 0 ? { tools: definitions } : {}),
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
        // --- Delegation ----------------------------------------------------
        // Offered only to an agent with the capability and at least one live
        // grant, and every constraint is re-decided here rather than trusted
        // from the model's request.
        if (delegation?.isDelegationTool(call.name)) {
          const plan = delegation.prepare(call.arguments);
          if (!plan.ok) {
            state.toolCalls.push({
              id: call.id,
              toolId: DELEGATION_TOOL_NAME,
              arguments: call.arguments,
              status: plan.status,
              message: plan.reason,
            });
            yield {
              type: "tool-result",
              id: call.id,
              result: { toolId: DELEGATION_TOOL_NAME, status: plan.status, reason: plan.reason, arguments: call.arguments },
            };
            history.push({ role: "tool", toolCallId: call.id, content: plan.reason });
            continue;
          }

          // Safe progress, by name only. No prompt, no reasoning, no ids.
          yield {
            type: "tool-result",
            id: `${call.id}:started`,
            result: {
              toolId: DELEGATION_TOOL_NAME,
              status: "executed",
              reason: `${plan.childAgentName} started`,
              arguments: { agent: plan.childAgentName },
            } satisfies AgentToolResultPayload,
          };

          const outcome = await delegation.run(plan, signal);
          if (outcome.requiresApproval) state.requiresApproval = true;
          state.toolCalls.push({
            id: call.id,
            toolId: DELEGATION_TOOL_NAME,
            arguments: { agent: plan.childAgentName, task: plan.task },
            status: outcome.status,
            message: outcome.message,
            ...(outcome.resultText === null ? {} : { result: outcome.resultText }),
          });
          yield {
            type: "tool-result",
            id: call.id,
            result: {
              toolId: DELEGATION_TOOL_NAME,
              status: outcome.status,
              reason: outcome.message,
              arguments: { agent: plan.childAgentName },
            } satisfies AgentToolResultPayload,
          };
          history.push({ role: "tool", toolCallId: call.id, content: outcome.resultText ?? outcome.message });
          if (outcome.resultText !== null) fedBack += 1;
          continue;
        }

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
          if (resolution.status === "approval_required") state.requiresApproval = true;
          state.toolCalls.push({
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
          state.toolCalls.push({ id: call.id, toolId: ref, arguments: call.arguments, status: "unavailable", message });
          yield { type: "tool-result", id: call.id, result: { toolId: ref, status: "unavailable", reason: message, arguments: call.arguments } };
          history.push({ role: "tool", toolCallId: call.id, content: message });
          continue;
        }

        executed += 1;
        const outcome = await mcp.execute({ toolRef: ref, arguments: call.arguments, signal });
        const status = statusForOutcome(outcome.status);
        if (status === "approval_required") state.requiresApproval = true;

        state.toolCalls.push({
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
  };

  // Accumulation is the engine's own, so an adapter cannot forget it and the
  // two adapters cannot disagree about what the turn produced.
  const events = (async function* (): AsyncIterable<ChatStreamEvent> {
    for await (const event of produce()) {
      if (event.type === "text-delta") state.text += event.delta;
      // Summed, not replaced: a turn that calls a tool runs more than one
      // completion, and billing the last one only would under-report it.
      else if (event.type === "usage") {
        state.usage = state.usage
          ? {
              inputTokens: state.usage.inputTokens + event.usage.inputTokens,
              outputTokens: state.usage.outputTokens + event.usage.outputTokens,
            }
          : event.usage;
      } else if (event.type === "sources") state.sources = event.sources;
      yield event;
    }
  })();

  return {
    conversationId,
    events,
    async finalize(): Promise<AgentTurnOutcome> {
      try {
        if (transcript === "conversation" && conversationId && (state.text.trim() || state.toolCalls.length > 0)) {
          await appendMessage({
            workspaceId,
            conversationId,
            role: "assistant",
            content: state.text,
            sources: state.sources.length > 0 ? state.sources : null,
            toolCalls: state.toolCalls.length > 0 ? state.toolCalls : null,
            usage: state.usage,
          });
        }
        // Metered for every turn, delegated ones included: a child agent's
        // tokens are real spend and are attributed to the child that spent them.
        const usageEvents: Array<{ kind: "message" | "tokens_in" | "tokens_out"; quantity: number; refType: string; refId: string }> = [
          { kind: "message", quantity: 1, refType: "agent", refId: agent.id },
        ];
        if (state.usage) {
          const resolved: TokenUsage = state.usage;
          usageEvents.push({ kind: "tokens_in", quantity: resolved.inputTokens, refType: "agent", refId: agent.id });
          usageEvents.push({ kind: "tokens_out", quantity: resolved.outputTokens, refType: "agent", refId: agent.id });
        }
        await recordUsageBatch(workspaceId, usageEvents);
      } catch (error) {
        console.error("[agents] failed to persist assistant turn", error);
      }
      return state;
    },
  };
}

/** The name the model calls to delegate. Declared here so the engine can recognise it. */
export const DELEGATION_TOOL_NAME = "delegate_to_agent";
