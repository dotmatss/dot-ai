import { queryOptions, useQuery } from "@tanstack/react-query";

import { intelligenceApi } from "@/features/intelligence/api";
import type { TopicListFilters } from "@/features/intelligence/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import type { PaginationParams } from "@/types/pagination";

/**
 * A topic's conversations live under its detail key, so finishing an analysis
 * can invalidate `all()` and take every derived list with it - the counts on a
 * topic row and the rows behind it are produced by the same run and must never
 * be refetched independently.
 */
export const intelligenceKeys = {
  all: (workspaceSlug: string) => ["workspaces", workspaceSlug, "intelligence"] as const,
  overview: (workspaceSlug: string) => [...intelligenceKeys.all(workspaceSlug), "overview"] as const,
  topics: (workspaceSlug: string) => [...intelligenceKeys.all(workspaceSlug), "topics"] as const,
  lists: (workspaceSlug: string) => [...intelligenceKeys.topics(workspaceSlug), "list"] as const,
  list: (workspaceSlug: string, filters: TopicListFilters) => [...intelligenceKeys.lists(workspaceSlug), filters] as const,
  detail: (workspaceSlug: string, topicId: string) => [...intelligenceKeys.topics(workspaceSlug), "detail", topicId] as const,
  conversationsAll: (workspaceSlug: string, topicId: string) =>
    [...intelligenceKeys.detail(workspaceSlug, topicId), "conversations"] as const,
  conversations: (workspaceSlug: string, topicId: string, page: number) =>
    [...intelligenceKeys.conversationsAll(workspaceSlug, topicId), page] as const,
  runs: (workspaceSlug: string) => [...intelligenceKeys.all(workspaceSlug), "runs"] as const,
};

/** Shared definitions so server prefetch and client hooks agree on keys. */
export const intelligenceQueries = {
  overview: (workspaceSlug: string) =>
    queryOptions({
      queryKey: intelligenceKeys.overview(workspaceSlug),
      queryFn: () => intelligenceApi.overview(workspaceSlug),
    }),
  list: (workspaceSlug: string, filters: TopicListFilters) =>
    queryOptions({
      queryKey: intelligenceKeys.list(workspaceSlug, filters),
      queryFn: () => intelligenceApi.listTopics(workspaceSlug, filters),
    }),
  detail: (workspaceSlug: string, topicId: string) =>
    queryOptions({
      queryKey: intelligenceKeys.detail(workspaceSlug, topicId),
      queryFn: () => intelligenceApi.getTopic(workspaceSlug, topicId),
    }),
  conversations: (workspaceSlug: string, topicId: string, params: PaginationParams = {}) =>
    queryOptions({
      queryKey: intelligenceKeys.conversations(workspaceSlug, topicId, params.page ?? 1),
      queryFn: () => intelligenceApi.listTopicConversations(workspaceSlug, topicId, params),
    }),
  runs: (workspaceSlug: string) =>
    queryOptions({
      queryKey: intelligenceKeys.runs(workspaceSlug),
      queryFn: () => intelligenceApi.listRuns(workspaceSlug),
    }),
};

export function useTopicsQuery(filters: TopicListFilters) {
  const { membership } = useWorkspace();
  return useQuery({
    ...intelligenceQueries.list(membership.workspace.slug, filters),
    placeholderData: (previous) => previous,
  });
}

export function useTopicQuery(topicId: string) {
  const { membership } = useWorkspace();
  return useQuery(intelligenceQueries.detail(membership.workspace.slug, topicId));
}

export function useTopicConversationsQuery(topicId: string, page: number) {
  const { membership } = useWorkspace();
  return useQuery({
    ...intelligenceQueries.conversations(membership.workspace.slug, topicId, { page }),
    placeholderData: (previous) => previous,
  });
}

export function useIntelligenceOverviewQuery() {
  const { membership } = useWorkspace();
  return useQuery(intelligenceQueries.overview(membership.workspace.slug));
}

export function useAnalysisRunsQuery() {
  const { membership } = useWorkspace();
  return useQuery(intelligenceQueries.runs(membership.workspace.slug));
}
