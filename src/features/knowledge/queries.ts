import { queryOptions, useQuery } from "@tanstack/react-query";

import { knowledgeApi } from "@/features/knowledge/api";
import { isSourceInFlight, type KnowledgeBaseListFilters, type KnowledgeSourceListFilters } from "@/features/knowledge/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";

export const knowledgeKeys = {
  all: (workspaceSlug: string) => ["workspaces", workspaceSlug, "knowledge"] as const,
  lists: (workspaceSlug: string) => [...knowledgeKeys.all(workspaceSlug), "list"] as const,
  list: (workspaceSlug: string, filters: KnowledgeBaseListFilters) =>
    [...knowledgeKeys.lists(workspaceSlug), filters] as const,
  detail: (workspaceSlug: string, knowledgeBaseId: string) =>
    [...knowledgeKeys.all(workspaceSlug), "detail", knowledgeBaseId] as const,
  sources: (workspaceSlug: string, knowledgeBaseId: string) =>
    [...knowledgeKeys.detail(workspaceSlug, knowledgeBaseId), "sources"] as const,
  sourceList: (workspaceSlug: string, knowledgeBaseId: string, filters: KnowledgeSourceListFilters) =>
    [...knowledgeKeys.sources(workspaceSlug, knowledgeBaseId), filters] as const,
};

/** Shared query definitions so server prefetch and client hooks agree on keys. */
export const knowledgeQueries = {
  list: (workspaceSlug: string, filters: KnowledgeBaseListFilters) =>
    queryOptions({
      queryKey: knowledgeKeys.list(workspaceSlug, filters),
      queryFn: () => knowledgeApi.list(workspaceSlug, filters),
    }),
  detail: (workspaceSlug: string, knowledgeBaseId: string) =>
    queryOptions({
      queryKey: knowledgeKeys.detail(workspaceSlug, knowledgeBaseId),
      queryFn: () => knowledgeApi.get(workspaceSlug, knowledgeBaseId),
    }),
  sources: (workspaceSlug: string, knowledgeBaseId: string, filters: KnowledgeSourceListFilters) =>
    queryOptions({
      queryKey: knowledgeKeys.sourceList(workspaceSlug, knowledgeBaseId, filters),
      queryFn: () => knowledgeApi.listSources(workspaceSlug, knowledgeBaseId, filters),
    }),
};

export function useKnowledgeBasesQuery(filters: KnowledgeBaseListFilters) {
  const { membership } = useWorkspace();
  return useQuery({
    ...knowledgeQueries.list(membership.workspace.slug, filters),
    placeholderData: (previous) => previous,
  });
}

export function useKnowledgeBaseQuery(knowledgeBaseId: string) {
  const { membership } = useWorkspace();
  return useQuery(knowledgeQueries.detail(membership.workspace.slug, knowledgeBaseId));
}

/**
 * Sources poll while any of them is mid-pipeline: processing can be triggered
 * from another session, so the table has to converge without a manual refresh.
 */
export function useKnowledgeSourcesQuery(knowledgeBaseId: string, filters: KnowledgeSourceListFilters) {
  const { membership } = useWorkspace();
  return useQuery({
    ...knowledgeQueries.sources(membership.workspace.slug, knowledgeBaseId, filters),
    placeholderData: (previous) => previous,
    refetchInterval: (query) => (query.state.data?.items.some((source) => isSourceInFlight(source.status)) ? 3_000 : false),
  });
}
