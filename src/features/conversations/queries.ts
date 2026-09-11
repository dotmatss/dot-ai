import { queryOptions, useQuery } from "@tanstack/react-query";

import { conversationsApi } from "@/features/conversations/api";
import type { ConversationListFilters } from "@/features/conversations/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";

export const conversationKeys = {
  all: (workspaceSlug: string) => ["workspaces", workspaceSlug, "conversations"] as const,
  lists: (workspaceSlug: string) => [...conversationKeys.all(workspaceSlug), "list"] as const,
  list: (workspaceSlug: string, filters: ConversationListFilters) => [...conversationKeys.lists(workspaceSlug), filters] as const,
  detail: (workspaceSlug: string, conversationId: string) =>
    [...conversationKeys.all(workspaceSlug), "detail", conversationId] as const,
  contactSearch: (workspaceSlug: string, term: string) =>
    [...conversationKeys.all(workspaceSlug), "contact-search", term] as const,
};

/** Shared query definitions so server prefetch and client hooks agree on keys. */
export const conversationQueries = {
  list: (workspaceSlug: string, filters: ConversationListFilters) =>
    queryOptions({
      queryKey: conversationKeys.list(workspaceSlug, filters),
      queryFn: () => conversationsApi.list(workspaceSlug, filters),
    }),
  detail: (workspaceSlug: string, conversationId: string) =>
    queryOptions({
      queryKey: conversationKeys.detail(workspaceSlug, conversationId),
      queryFn: () => conversationsApi.get(workspaceSlug, conversationId),
    }),
  contactSearch: (workspaceSlug: string, term: string) =>
    queryOptions({
      queryKey: conversationKeys.contactSearch(workspaceSlug, term),
      queryFn: () => conversationsApi.searchContacts(workspaceSlug, term),
    }),
};

export function useConversationsQuery(filters: ConversationListFilters) {
  const { membership } = useWorkspace();
  return useQuery({ ...conversationQueries.list(membership.workspace.slug, filters), placeholderData: (previous) => previous });
}

export function useConversationQuery(conversationId: string) {
  const { membership } = useWorkspace();
  return useQuery(conversationQueries.detail(membership.workspace.slug, conversationId));
}

/**
 * Contact type-ahead for the link dialog. Disabled below two characters so a
 * single keystroke does not scan the whole contact table.
 */
export function useContactSearchQuery(term: string) {
  const { membership } = useWorkspace();
  const trimmed = term.trim();
  return useQuery({
    ...conversationQueries.contactSearch(membership.workspace.slug, trimmed),
    enabled: trimmed.length >= 2,
    staleTime: 30_000,
  });
}
