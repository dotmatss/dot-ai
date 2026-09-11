import {
  MESSAGE_ROLE_META,
  SUMMARY_MAX_MESSAGE_CHARS,
  SUMMARY_MAX_MESSAGES,
  SUMMARY_MAX_TRANSCRIPT_CHARS,
  TEAM_AUTHOR_LABEL,
} from "@/features/conversations/constants";
import type { ConversationMessage } from "@/features/conversations/types";

export interface TranscriptCaps {
  maxMessages: number;
  maxMessageChars: number;
  maxTranscriptChars: number;
}

export const DEFAULT_TRANSCRIPT_CAPS: TranscriptCaps = {
  maxMessages: SUMMARY_MAX_MESSAGES,
  maxMessageChars: SUMMARY_MAX_MESSAGE_CHARS,
  maxTranscriptChars: SUMMARY_MAX_TRANSCRIPT_CHARS,
};

/** A team member's reply is stored as an assistant turn, so the author decides the label. */
export function transcriptSpeaker(message: Pick<ConversationMessage, "role" | "author">): string {
  return message.author ? TEAM_AUTHOR_LABEL : MESSAGE_ROLE_META[message.role].label;
}

function truncate(value: string, limit: number): string {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized;
}

/**
 * Renders a conversation as a plain-text transcript for the summarizer.
 *
 * Three caps apply in order, because an unbounded thread would otherwise decide
 * how much a single request costs: the newest `maxMessages` turns are kept, each
 * turn is truncated, and the oldest remaining turns are dropped until the whole
 * transcript fits the character budget. Recency wins in every case — the end of
 * a support thread carries the outcome.
 */
export function buildSummaryTranscript(
  messages: ReadonlyArray<Pick<ConversationMessage, "role" | "content" | "author">>,
  caps: TranscriptCaps = DEFAULT_TRANSCRIPT_CAPS,
): string {
  const recent = messages.slice(-caps.maxMessages);
  const lines: string[] = [];
  let length = 0;

  // Walk backwards so the budget is spent on the most recent turns.
  for (let index = recent.length - 1; index >= 0; index--) {
    const message = recent[index];
    if (!message) continue;
    const content = truncate(message.content, caps.maxMessageChars);
    if (!content) continue;
    const line = `${transcriptSpeaker(message)}: ${content}`;
    const cost = line.length + (lines.length > 0 ? 2 : 0);
    if (length + cost > caps.maxTranscriptChars) break;
    lines.push(line);
    length += cost;
  }

  return lines.reverse().join("\n\n");
}
