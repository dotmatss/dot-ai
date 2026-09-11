/**
 * Client-safe CRM contracts. Timestamps are ISO strings and every value is
 * JSON-serializable so the same types cross the server/client boundary.
 */

export const CONTACT_STAGES = ["lead", "prospect", "customer", "churned"] as const;
export type ContactStage = (typeof CONTACT_STAGES)[number];

/**
 * Custom properties are a flat string map. The column is `jsonb`, so a value
 * written by an integration can be an object or a number; the repository
 * renders those as JSON text rather than dropping them, and the editor writes
 * strings back. Structured values therefore survive reads but are flattened if
 * a human edits the record - an accepted trade-off for a user-facing editor.
 */
export type ContactProperties = Record<string, string>;

export interface ContactSummary {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  stage: ContactStage;
  source: string | null;
  tags: string[];
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Contact extends ContactSummary {
  workspaceId: string;
  properties: ContactProperties;
  aiSummary: string | null;
  noteCount: number;
  conversationCount: number;
  activityCount: number;
}

export interface ContactListFilters {
  q?: string;
  stage?: ContactStage;
  tag?: string;
  page?: number;
  pageSize?: number;
}

export interface ContactTagCount {
  tag: string;
  count: number;
}

export interface ContactNoteAuthor {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface ContactNote {
  id: string;
  contactId: string;
  body: string;
  /** Null when the author's account was deleted (author_id is set null). */
  author: ContactNoteAuthor | null;
  createdAt: string;
}

/**
 * One entry of the merged contact history: a recorded activity, a note, or a
 * conversation. `id` is prefixed by kind because the three sources have
 * independent id spaces and React needs one stable key across the merge.
 */
export interface ContactTimelineEntry {
  id: string;
  kind: "activity" | "note" | "conversation";
  /** Activity type, or "note" / "conversation" for the other two sources. */
  type: string;
  title: string;
  body: string | null;
  /** Who performed it, when known. Activity actors are denormalized at write time. */
  actorName: string | null;
  /** Conversation id for entries that link somewhere. */
  refId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ContactConversation {
  id: string;
  title: string | null;
  status: string;
  channel: string;
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
  /** Chatbot or agent that handled the thread, when one is still linked. */
  sourceName: string | null;
}
