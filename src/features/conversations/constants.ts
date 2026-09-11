import type { BadgeTone } from "@/components/ui/app-badge";
import type { ConversationChannel, ConversationStatus, MessageRole } from "@/features/conversations/types";

export const CONVERSATION_STATUS_META: Record<ConversationStatus, { label: string; tone: BadgeTone; description: string }> = {
  open: { label: "Open", tone: "info", description: "Awaiting a reply or still in progress." },
  resolved: { label: "Resolved", tone: "success", description: "The visitor's question was answered." },
  escalated: { label: "Escalated", tone: "warning", description: "Needs attention from a team member." },
};

export const CONVERSATION_CHANNEL_META: Record<ConversationChannel, { label: string; description: string }> = {
  widget: { label: "Widget", description: "Started from an embedded chat widget." },
  playground: { label: "Playground", description: "Internal test session from the playground." },
  api: { label: "API", description: "Created through the public API." },
  agent: { label: "Agent", description: "Run by an autonomous agent." },
};

export const MESSAGE_ROLE_META: Record<MessageRole, { label: string }> = {
  user: { label: "Visitor" },
  assistant: { label: "Assistant" },
  system: { label: "System" },
  tool: { label: "Tool" },
};

/** Label used for assistant-role messages written by a team member. */
export const TEAM_AUTHOR_LABEL = "Team";

/** Upper bound on messages fed to the summarizer; older turns are dropped. */
export const SUMMARY_MAX_MESSAGES = 60;
/** Per-message character cap in the summary transcript. */
export const SUMMARY_MAX_MESSAGE_CHARS = 1_500;
/** Overall transcript character cap sent to the model. */
export const SUMMARY_MAX_TRANSCRIPT_CHARS = 24_000;

export const CONTACT_SEARCH_DEFAULT_LIMIT = 8;

/**
 * Messages loaded into the detail view in one request. Threads are append-only
 * and unbounded, so the view shows the most recent turns and tells the reader
 * when older ones were left behind rather than streaming an entire history.
 */
export const CONVERSATION_DETAIL_MESSAGE_LIMIT = 200;
