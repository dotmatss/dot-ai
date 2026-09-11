import "server-only";

import { buildSummaryTranscript } from "@/features/conversations/transcript";
import type { ConversationMessage } from "@/features/conversations/types";
import { ApiError } from "@/lib/api/api-error";
import { getAiGateway } from "@/server/ai";
import type { ChatMessage, TokenUsage } from "@/types/ai";

/** Recaps are read at a glance in a side panel, so the reply stays short. */
const SUMMARY_MAX_OUTPUT_TOKENS = 400;

const SUMMARY_SYSTEM_PROMPT = [
  "You summarize customer conversations for a support inbox.",
  "Write 3 to 5 sentences of plain prose covering: what the person asked about, what was answered or promised, and whether anything is still open.",
  "Use only what the transcript states. If something is unclear, say so rather than guessing.",
  "Do not use markdown, headings, bullet points or a preamble such as 'Here is a summary'.",
  "Messages labelled Team were written by a human colleague; messages labelled Assistant came from the AI.",
].join(" ");

export interface GeneratedSummary {
  text: string;
  /** Model identifier reported by the gateway, stored so a recap can be attributed. */
  model: string;
  usage: TokenUsage | null;
}

/**
 * Builds a capped transcript and summarizes it through the AI boundary.
 *
 * The gateway only streams, so the deltas are collected into a string here: the
 * recap is stored, not rendered live, and a partial summary would be worse than
 * a spinner.
 */
export async function generateConversationSummary(input: {
  workspaceId: string;
  conversationId: string;
  title: string | null;
  messages: ReadonlyArray<Pick<ConversationMessage, "role" | "content" | "author">>;
  signal?: AbortSignal;
}): Promise<GeneratedSummary> {
  const transcript = buildSummaryTranscript(input.messages);
  if (!transcript) throw ApiError.badRequest("This conversation has no messages to summarize yet");

  const messages: ChatMessage[] = [
    { role: "system", content: SUMMARY_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Conversation title: ${input.title?.trim() || "Untitled"}\n\nTranscript:\n\n${transcript}`,
    },
  ];

  const gateway = getAiGateway();
  let text = "";
  let model = "";
  let usage: TokenUsage | null = null;

  for await (const event of gateway.streamChat({
    messages,
    maxTokens: SUMMARY_MAX_OUTPUT_TOKENS,
    temperature: 0.2,
    signal: input.signal,
    metadata: { workspaceId: input.workspaceId, conversationId: input.conversationId, purpose: "conversation-summary" },
  })) {
    if (event.type === "text-delta") text += event.delta;
    else if (event.type === "start") model = event.model;
    else if (event.type === "usage") usage = event.usage;
    else if (event.type === "error") throw ApiError.unavailable(event.message);
  }

  const summary = text.trim();
  if (!summary) throw ApiError.unavailable("The model returned an empty summary");
  return { text: summary, model: model || gateway.provider, usage };
}
