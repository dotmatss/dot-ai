import type { HumanReplyInput, UpdateConversationInput } from "@/features/conversations/schemas";
import type {
  ContactSearchResult,
  Conversation,
  ConversationDetail,
  ConversationListFilters,
  ConversationListItem,
  ConversationReplyResult,
} from "@/features/conversations/types";
import { apiFetch, buildQueryString } from "@/lib/api/http";
import type { Paginated } from "@/types/pagination";

const base = (workspaceSlug: string) => `/api/v1/w/${workspaceSlug}/conversations`;

/** Client-side API surface for the conversations inbox. */
export const conversationsApi = {
  list: (workspaceSlug: string, filters: ConversationListFilters = {}) =>
    apiFetch<Paginated<ConversationListItem>>(`${base(workspaceSlug)}${buildQueryString(filters)}`),
  get: (workspaceSlug: string, conversationId: string) =>
    apiFetch<ConversationDetail>(`${base(workspaceSlug)}/${conversationId}`),
  update: (workspaceSlug: string, conversationId: string, input: UpdateConversationInput) =>
    apiFetch<Conversation>(`${base(workspaceSlug)}/${conversationId}`, { method: "PATCH", json: input }),
  reply: (workspaceSlug: string, conversationId: string, input: HumanReplyInput) =>
    apiFetch<ConversationReplyResult>(`${base(workspaceSlug)}/${conversationId}/reply`, { method: "POST", json: input }),
  summarize: (workspaceSlug: string, conversationId: string) =>
    apiFetch<Conversation>(`${base(workspaceSlug)}/${conversationId}/summary`, { method: "POST" }),
  searchContacts: (workspaceSlug: string, q: string, limit?: number) =>
    apiFetch<ContactSearchResult[]>(`${base(workspaceSlug)}/contacts-search${buildQueryString({ q, limit })}`),
};
