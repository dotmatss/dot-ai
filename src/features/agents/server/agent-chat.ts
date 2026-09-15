import "server-only";

import type { AgentChatInput } from "@/features/agents/schemas";
import { FULL_TOOL_POLICY, startAgentTurn } from "@/features/agents/server/agent-engine";
import { createBudget, openRootExecution, type AgentExecutionContext } from "@/features/agents/server/agent-execution";
import { attachExecutionConversation, closeAgentExecution } from "@/features/agents/server/agent-execution-repository";
import { loadDelegationContext } from "@/features/agents/server/delegation";
import type { Agent } from "@/features/agents/types";
import { eventsToSseResponse } from "@/server/ai/sse";

interface RunAgentChatOptions {
  agent: Agent;
  input: AgentChatInput;
  signal: AbortSignal;
  /** The person whose turn this is, recorded against any tool call it makes. */
  userId?: string | null;
  metadata?: Record<string, string>;
}

/**
 * Streaming adapter over the agent engine.
 *
 * One of two adapters; the other is `executeAgentTask`, which collects the same
 * turn into a value for a supervisor. Everything the turn *does* - retrieval,
 * the completion loop, tool resolution, MCP execution, delegation, persistence
 * and metering - lives in `agent-engine.ts`, so the two cannot drift.
 *
 * A supervisor additionally gets a root execution and a budget. Both are opened
 * here rather than in the engine, because a standard agent needs neither and
 * should pay for neither: an agent without the delegation capability runs
 * exactly the queries it ran before this feature existed.
 */
export async function runAgentChat(options: RunAgentChatOptions): Promise<Response> {
  const { agent, signal } = options;
  const userId = options.userId ?? null;

  let root: AgentExecutionContext | null = null;
  let delegation = undefined;

  if (agent.canDelegate) {
    // The budget is created from this agent's own configuration and then shared
    // by every agent in the tree, so three sequential children divide one
    // allowance rather than each receiving a fresh one.
    root = await openRootExecution({
      workspaceId: agent.workspaceId,
      agentId: agent.id,
      conversationId: null,
      budget: createBudget(agent.delegationConfig),
      userId,
      // A person's own turn: everything the agent is configured with.
      toolPolicy: FULL_TOOL_POLICY,
    });
    delegation = await loadDelegationContext({ workspaceId: agent.workspaceId, agent, execution: root, userId });
  }

  let turn;
  try {
    turn = await startAgentTurn({
      agent,
      input: options.input,
      signal,
      userId,
      metadata: { ...options.metadata, ...(root ? { executionId: root.executionId } : {}) },
      transcript: "conversation",
      delegation,
    });
  } catch (error) {
    // Preparing the turn can refuse (a conversation that belongs to another
    // agent, a transcript with no user message). The root row was opened
    // before that could be known; close it rather than leave it `running`.
    if (root) {
      await closeAgentExecution(agent.workspaceId, root.executionId, { status: "failed", error: "The turn could not start." }).catch(() => undefined);
    }
    throw error;
  }

  if (root && turn.conversationId) {
    // Safe to do after the turn is prepared and before any event is consumed:
    // delegation only happens while the stream is being drained.
    root.conversationId = turn.conversationId;
    await attachExecutionConversation(agent.workspaceId, root.executionId, turn.conversationId);
  }

  return eventsToSseResponse(turn.events, {
    signal,
    onFinish: async () => {
      const outcome = await turn.finalize();
      if (!root) return;
      const text = outcome.text.trim();
      await closeAgentExecution(agent.workspaceId, root.executionId, {
        status: text ? "succeeded" : "failed",
        output: text || null,
        error: text ? null : "The agent returned no answer.",
        requiresApproval: outcome.requiresApproval,
        inputTokens: outcome.usage?.inputTokens ?? 0,
        outputTokens: outcome.usage?.outputTokens ?? 0,
      });
    },
  });
}
