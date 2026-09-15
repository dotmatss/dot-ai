import "server-only";

import { findAgentById } from "@/features/agents/server/agent-repository";
import { buildAgentBackedSystemPrompt, buildChatbotSystemPrompt } from "@/features/chatbots/server/prompt";
import type { Chatbot, ChatbotModelConfig } from "@/features/chatbots/types";
import { ApiError } from "@/lib/api/api-error";
import type { DatabaseClient } from "@/server/db/client";

/**
 * The one place that decides what a chatbot turn actually runs on.
 *
 * A chatbot is a channel; the AI configuration behind it comes from either the
 * chatbot's own columns (standalone, the only option before migration 0020) or
 * from an agent it deploys. Every entry point - the widget, the public API and
 * the authenticated playground - goes through `runChatbotChat`, which calls
 * this, so there is exactly one answer to "which configuration is live" and no
 * channel can drift from the others.
 *
 * WHAT AN AGENT-BACKED CHATBOT INHERITS
 * -------------------------------------
 * Instructions, model configuration and knowledge collections. That is the
 * whole list, and the omissions are the point:
 *
 *   tools, MCP attachments, memory window, structured output, approvals
 *
 * are agent-RUNTIME features and they stay in the agent runtime. A chatbot
 * channel is reachable by anonymous visitors, and `runAgentChat` really does
 * execute MCP tools against the workspace's sealed credentials. Making a
 * chatbot "use an agent" must not quietly turn every website visitor into
 * someone who can drive those tools. Linking an agent therefore changes what
 * the model is TOLD, never what it is ABLE to do, and the public attack
 * surface is identical before and after.
 *
 * Knowledge follows the same rule and resolves to ONE source, never a union:
 * an agent-backed chatbot retrieves from the agent's collections only. Merging
 * the two lists would let linking an agent silently widen what a public widget
 * can retrieve, which is the one knowledge bug that matters. The chatbot's own
 * `chatbot_collections` rows are left untouched, so unlinking restores exactly
 * the previous behaviour.
 */
export interface ChatbotRuntime {
  /** Which configuration won. `"chatbot"` is the standalone/legacy path. */
  source: "agent" | "chatbot";
  /** Set only when an agent is backing this chatbot; recorded on conversations. */
  agentId: string | null;
  agentName: string | null;
  systemPrompt: string;
  modelConfig: ChatbotModelConfig;
  /** Collections this turn may retrieve from. Exactly one source, never merged. */
  collectionIds: string[];
}

export async function resolveChatbotRuntime(chatbot: Chatbot, client?: DatabaseClient): Promise<ChatbotRuntime> {
  if (!chatbot.agentId) {
    return {
      source: "chatbot",
      agentId: null,
      agentName: null,
      systemPrompt: buildChatbotSystemPrompt(chatbot),
      modelConfig: chatbot.modelConfig,
      collectionIds: chatbot.collectionIds,
    };
  }

  // Scoped by the CHATBOT's workspace, never by the agent id alone. The
  // composite foreign key already makes a cross-workspace link impossible to
  // store; this keeps the read honest even if that constraint were ever
  // dropped, and it is why no caller is allowed to pass an agent id in.
  const agent = await findAgentById(chatbot.workspaceId, chatbot.agentId, client);

  // Fail closed. Both branches are unreachable while the foreign key and the
  // archive guard in `agent-service.ts` hold, so reaching one means an
  // invariant broke - and the wrong response to that is to quietly serve the
  // chatbot's old instructions, which is a configuration nobody chose and
  // which may be months out of date.
  if (!agent) {
    console.error("[chatbots] agent-backed chatbot resolved to no agent", { chatbotId: chatbot.id, agentId: chatbot.agentId });
    throw ApiError.unavailable("This chatbot is temporarily unavailable");
  }
  if (agent.status === "archived") {
    console.error("[chatbots] agent-backed chatbot resolved to an archived agent", { chatbotId: chatbot.id, agentId: agent.id });
    throw ApiError.unavailable("This chatbot is temporarily unavailable");
  }
  // A supervisor must never run on an anonymous channel. Both services refuse
  // to create this combination, so reaching here means one of those guards was
  // bypassed - and the answer to that is to stop, not to serve the supervisor's
  // instructions with its delegation silently removed.
  if (agent.canDelegate) {
    console.error("[chatbots] agent-backed chatbot resolved to a supervisor agent", { chatbotId: chatbot.id, agentId: agent.id });
    throw ApiError.unavailable("This chatbot is temporarily unavailable");
  }

  return {
    source: "agent",
    agentId: agent.id,
    agentName: agent.name,
    systemPrompt: buildAgentBackedSystemPrompt(agent.instructions),
    modelConfig: agent.modelConfig,
    collectionIds: agent.collectionIds,
  };
}
