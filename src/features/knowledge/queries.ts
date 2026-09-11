import { queryOptions, useQuery } from "@tanstack/react-query";

import { knowledgeApi, scopeParam } from "@/features/knowledge/api";
import {
  isSourceInFlight,
  type CollectionListFilters,
  type KnowledgeScope,
  type KnowledgeSourceListFilters,
} from "@/features/knowledge/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";

export const knowledgeKeys = {
  all: (workspaceSlug: string) => ["workspaces", workspaceSlug, "knowledge"] as const,

  overview: (workspaceSlug: string) => [...knowledgeKeys.all(workspaceSlug), "overview"] as const,

  collections: (workspaceSlug: string) => [...knowledgeKeys.all(workspaceSlug), "collections"] as const,
  collectionLists: (workspaceSlug: string) => [...knowledgeKeys.collections(workspaceSlug), "list"] as const,
  collectionList: (workspaceSlug: string, filters: CollectionListFilters) =>
    [...knowledgeKeys.collectionLists(workspaceSlug), filters] as const,
  collection: (workspaceSlug: string, collectionId: string) =>
    [...knowledgeKeys.collections(workspaceSlug), "detail", collectionId] as const,
  collectionOptions: (workspaceSlug: string) => [...knowledgeKeys.collections(workspaceSlug), "options"] as const,

  // Source listings are keyed by scope, not by collection id, so "all",
  // "unorganized" and a given collection are three distinct caches rather than
  // one cache that quietly serves the wrong rows.
  sources: (workspaceSlug: string) => [...knowledgeKeys.all(workspaceSlug), "sources"] as const,
  sourceScope: (workspaceSlug: string, scope: KnowledgeScope) =>
    [...knowledgeKeys.sources(workspaceSlug), scopeParam(scope)] as const,
  sourceList: (workspaceSlug: string, scope: KnowledgeScope, filters: KnowledgeSourceListFilters) =>
    [...knowledgeKeys.sourceScope(workspaceSlug, scope), filters] as const,
};

/** Shared query definitions so server prefetch and client hooks agree on keys. */
export const knowledgeQueries = {
  overview: (workspaceSlug: string) =>
    queryOptions({
      queryKey: knowledgeKeys.overview(workspaceSlug),
      queryFn: () => knowledgeApi.overview(workspaceSlug),
    }),
  collectionList: (workspaceSlug: string, filters: CollectionListFilters) =>
    queryOptions({
      queryKey: knowledgeKeys.collectionList(workspaceSlug, filters),
      queryFn: () => knowledgeApi.listCollections(workspaceSlug, filters),
    }),
  collection: (workspaceSlug: string, collectionId: string) =>
    queryOptions({
      queryKey: knowledgeKeys.collection(workspaceSlug, collectionId),
      queryFn: () => knowledgeApi.getCollection(workspaceSlug, collectionId),
    }),
  collectionOptions: (workspaceSlug: string) =>
    queryOptions({
      queryKey: knowledgeKeys.collectionOptions(workspaceSlug),
      queryFn: () => knowledgeApi.collectionOptions(workspaceSlug),
    }),
  sources: (workspaceSlug: string, scope: KnowledgeScope, filters: KnowledgeSourceListFilters) =>
    queryOptions({
      queryKey: knowledgeKeys.sourceList(workspaceSlug, scope, filters),
      queryFn: () => knowledgeApi.listSources(workspaceSlug, scope, filters),
    }),
};

export function useKnowledgeOverviewQuery() {
  const { membership } = useWorkspace();
  return useQuery(knowledgeQueries.overview(membership.workspace.slug));
}

export function useCollectionsQuery(filters: CollectionListFilters) {
  const { membership } = useWorkspace();
  return useQuery({
    ...knowledgeQueries.collectionList(membership.workspace.slug, filters),
    placeholderData: (previous) => previous,
  });
}

export function useCollectionQuery(collectionId: string) {
  const { membership } = useWorkspace();
  return useQuery(knowledgeQueries.collection(membership.workspace.slug, collectionId));
}

/** The collections a document can be filed into. Rarely changes, so it is cached longer. */
export function useCollectionOptionsQuery() {
  const { membership } = useWorkspace();
  return useQuery({ ...knowledgeQueries.collectionOptions(membership.workspace.slug), staleTime: 60_000 });
}

/**
 * Sources poll while any of them is mid-pipeline: processing can be triggered
 * from another session, so the table has to converge without a manual refresh.
 */
export function useKnowledgeSourcesQuery(scope: KnowledgeScope, filters: KnowledgeSourceListFilters) {
  const { membership } = useWorkspace();
  return useQuery({
    ...knowledgeQueries.sources(membership.workspace.slug, scope, filters),
    placeholderData: (previous) => previous,
    refetchInterval: (query) => (query.state.data?.items.some((source) => isSourceInFlight(source.status)) ? 3_000 : false),
  });
}
