import { queryOptions, useQuery } from "@tanstack/react-query";

import { chatbotsApi } from "@/features/chatbots/api";
import type { ChatbotListFilters } from "@/features/chatbots/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";

export const chatbotKeys = {
  all: (workspaceSlug: string) => ["workspaces", workspaceSlug, "chatbots"] as const,
  lists: (workspaceSlug: string) => [...chatbotKeys.all(workspaceSlug), "list"] as const,
  list: (workspaceSlug: string, filters: ChatbotListFilters) => [...chatbotKeys.lists(workspaceSlug), filters] as const,
  detail: (workspaceSlug: string, chatbotId: string) => [...chatbotKeys.all(workspaceSlug), "detail", chatbotId] as const,
  knowledge: (workspaceSlug: string, chatbotId: string) => [...chatbotKeys.detail(workspaceSlug, chatbotId), "knowledge"] as const,
  overview: (workspaceSlug: string, chatbotId: string) => [...chatbotKeys.detail(workspaceSlug, chatbotId), "overview"] as const,
};

/** Shared query definitions so server prefetch and client hooks agree on keys. */
export const chatbotQueries = {
  list: (workspaceSlug: string, filters: ChatbotListFilters) =>
    queryOptions({
      queryKey: chatbotKeys.list(workspaceSlug, filters),
      queryFn: () => chatbotsApi.list(workspaceSlug, filters),
    }),
  detail: (workspaceSlug: string, chatbotId: string) =>
    queryOptions({
      queryKey: chatbotKeys.detail(workspaceSlug, chatbotId),
      queryFn: () => chatbotsApi.get(workspaceSlug, chatbotId),
    }),
  knowledge: (workspaceSlug: string, chatbotId: string) =>
    queryOptions({
      queryKey: chatbotKeys.knowledge(workspaceSlug, chatbotId),
      queryFn: () => chatbotsApi.knowledgeOptions(workspaceSlug, chatbotId),
    }),
  overview: (workspaceSlug: string, chatbotId: string) =>
    queryOptions({
      queryKey: chatbotKeys.overview(workspaceSlug, chatbotId),
      queryFn: () => chatbotsApi.overview(workspaceSlug, chatbotId),
    }),
};

export function useChatbotsQuery(filters: ChatbotListFilters) {
  const { membership } = useWorkspace();
  return useQuery({ ...chatbotQueries.list(membership.workspace.slug, filters), placeholderData: (previous) => previous });
}

export function useChatbotQuery(chatbotId: string) {
  const { membership } = useWorkspace();
  return useQuery(chatbotQueries.detail(membership.workspace.slug, chatbotId));
}

export function useChatbotKnowledgeQuery(chatbotId: string) {
  const { membership } = useWorkspace();
  return useQuery(chatbotQueries.knowledge(membership.workspace.slug, chatbotId));
}

export function useChatbotOverviewQuery(chatbotId: string) {
  const { membership } = useWorkspace();
  return useQuery(chatbotQueries.overview(membership.workspace.slug, chatbotId));
}
