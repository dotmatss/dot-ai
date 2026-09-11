import "server-only";

import type { PlaygroundChatInput } from "@/features/chatbots/schemas";
import { buildChatbotSystemPrompt } from "@/features/chatbots/server/prompt";
import type { Chatbot } from "@/features/chatbots/types";
import {
  appendMessage,
  createConversation,
  deriveConversationTitle,
  findConversation,
  type ConversationChannel,
} from "@/features/conversations/server/conversation-repository";
import { retrieveKnowledge } from "@/features/knowledge/server/retrieval";
import { ApiError } from "@/lib/api/api-error";
import { getAiGateway } from "@/server/ai";
import { eventsToSseResponse } from "@/server/ai/sse";
import { recordUsageBatch } from "@/server/usage/record-usage";
import type { ChatMessage, ChatStreamEvent, RetrievedSource, TokenUsage } from "@/types/ai";

interface RunChatbotChatOptions {
  chatbot: Chatbot;
  input: PlaygroundChatInput;
  channel: ConversationChannel;
  contactId?: string | null;
  signal: AbortSignal;
  metadata?: Record<string, string>;
}

/**
 * Executes one chatbot turn end-to-end and returns an SSE response:
 * persist the user message, retrieve knowledge, stream the model, persist the
 * assistant reply and record usage. Shared by the authenticated playground and
 * the public widget endpoint, which differ only in how they authorize.
 */
export async function runChatbotChat(options: RunChatbotChatOptions): Promise<Response> {
  const { chatbot, input, channel, signal } = options;
  const workspaceId = chatbot.workspaceId;
  const lastUser = [...input.messages].reverse().find((m) => m.role === "user");
  if (!lastUser) throw ApiError.badRequest("A user message is required");

  let conversationId = input.conversationId ?? null;
  if (conversationId) {
    const existing = await findConversation(workspaceId, conversationId);
    if (!existing || existing.chatbotId !== chatbot.id) throw ApiError.notFound("Conversation not found");
  } else {
    const created = await createConversation({
      workspaceId,
      chatbotId: chatbot.id,
      contactId: options.contactId ?? null,
      channel,
      title: deriveConversationTitle(lastUser.content),
    });
    conversationId = created.id;
  }

  await appendMessage({ workspaceId, conversationId, role: "user", content: lastUser.content });

  const sources = await retrieveKnowledge(workspaceId, chatbot.collectionIds, lastUser.content).catch(() => [] as RetrievedSource[]);

  const messages: ChatMessage[] = [
    { role: "system", content: buildChatbotSystemPrompt(chatbot) },
    ...input.messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const gateway = getAiGateway();
  const events = gateway.streamChat({
    model: chatbot.modelConfig.model ?? undefined,
    messages,
    temperature: chatbot.modelConfig.temperature,
    maxTokens: chatbot.modelConfig.maxTokens,
    sources,
    signal,
    metadata: { workspaceId, chatbotId: chatbot.id, channel, ...options.metadata },
  });

  let assistantText = "";
  let usage: TokenUsage | null = null;
  let emittedSources: RetrievedSource[] = sources;

  const withConversation = (async function* (): AsyncIterable<ChatStreamEvent> {
    // Let the client learn the conversation id first so follow-ups can continue it.
    yield { type: "tool-result", id: "conversation", result: { conversationId } };
    for await (const event of events) {
      yield event;
    }
  })();

  return eventsToSseResponse(withConversation, {
    signal,
    onEvent: (event) => {
      if (event.type === "text-delta") assistantText += event.delta;
      else if (event.type === "usage") usage = event.usage;
      else if (event.type === "sources") emittedSources = event.sources;
    },
    onFinish: async () => {
      if (!conversationId) return;
      try {
        if (assistantText.trim()) {
          await appendMessage({
            workspaceId,
            conversationId,
            role: "assistant",
            content: assistantText,
            sources: emittedSources.length > 0 ? emittedSources : null,
            usage,
          });
        }
        const usageEvents: Array<{ kind: "message" | "tokens_in" | "tokens_out"; quantity: number; refType: string; refId: string }> = [
          { kind: "message", quantity: 1, refType: "chatbot", refId: chatbot.id },
        ];
        if (usage) {
          const resolved: TokenUsage = usage;
          usageEvents.push({ kind: "tokens_in", quantity: resolved.inputTokens, refType: "chatbot", refId: chatbot.id });
          usageEvents.push({ kind: "tokens_out", quantity: resolved.outputTokens, refType: "chatbot", refId: chatbot.id });
        }
        await recordUsageBatch(workspaceId, usageEvents);
      } catch (error) {
        console.error("[chatbots] failed to persist assistant turn", error);
      }
    },
  });
}
