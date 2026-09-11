import type { RetrievedSource, TokenUsage } from "@/types/ai";

export const CONVERSATION_STATUSES = ["open", "resolved", "escalated"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const CONVERSATION_CHANNELS = ["widget", "playground", "api", "agent"] as const;
export type ConversationChannel = (typeof CONVERSATION_CHANNELS)[number];

export const MESSAGE_ROLES = ["user", "assistant", "system", "tool"] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

/** Chatbot or agent that produced the conversation (resolved via LEFT JOIN). */
export interface ConversationSourceRef {
  type: "chatbot" | "agent";
  id: string;
  name: string;
}

export interface ConversationContactRef {
  id: string;
  name: string | null;
  email: string | null;
}

export interface ConversationAssignee {
  id: string;
  name: string;
  avatarUrl: string | null;
}

/** AI-generated recap persisted in `conversations.metadata.summary`. */
export interface ConversationAiSummary {
  text: string;
  generatedAt: string;
  generatedBy: string | null;
  /** Number of messages the summary covered, so the UI can flag staleness. */
  messageCount: number;
}

/** Row shape for the inbox list. */
export interface ConversationListItem {
  id: string;
  title: string | null;
  status: ConversationStatus;
  channel: ConversationChannel;
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
  source: ConversationSourceRef | null;
  contact: ConversationContactRef | null;
  assignee: ConversationAssignee | null;
}

export interface Conversation extends ConversationListItem {
  workspaceId: string;
  summary: ConversationAiSummary | null;
}

export interface MessageAuthor {
  id: string;
  name: string;
}

export interface ConversationMessage {
  id: string;
  role: MessageRole;
  content: string;
  sources: RetrievedSource[] | null;
  toolCalls: unknown[] | null;
  usage: TokenUsage | null;
  /** Present when a team member wrote the message from the inbox. */
  author: MessageAuthor | null;
  createdAt: string;
}

export interface ConversationDetail {
  conversation: Conversation;
  messages: ConversationMessage[];
}

export interface ConversationReplyResult {
  conversation: Conversation;
  message: ConversationMessage;
}

export interface ConversationListFilters {
  q?: string;
  status?: ConversationStatus;
  channel?: ConversationChannel;
  chatbotId?: string;
  agentId?: string;
  contactId?: string;
  /** A user id, or the literal "me" which the server resolves to the caller. */
  assignedTo?: string;
  page?: number;
  pageSize?: number;
}

/** Minimal contact projection for the "Link to contact" search. */
export interface ContactSearchResult {
  id: string;
  name: string | null;
  email: string | null;
  company: string | null;
  stage: string;
}
