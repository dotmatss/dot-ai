import { queryOptions, useQuery } from "@tanstack/react-query";

import { agentsApi } from "@/features/agents/api";
import type { AgentListFilters } from "@/features/agents/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";

export const agentKeys = {
  all: (workspaceSlug: string) => ["workspaces", workspaceSlug, "agents"] as const,
  lists: (workspaceSlug: string) => [...agentKeys.all(workspaceSlug), "list"] as const,
  list: (workspaceSlug: string, filters: AgentListFilters) => [...agentKeys.lists(workspaceSlug), filters] as const,
  detail: (workspaceSlug: string, agentId: string) => [...agentKeys.all(workspaceSlug), "detail", agentId] as const,
  knowledge: (workspaceSlug: string, agentId: string) => [...agentKeys.detail(workspaceSlug, agentId), "knowledge"] as const,
  overview: (workspaceSlug: string, agentId: string) => [...agentKeys.detail(workspaceSlug, agentId), "overview"] as const,
  delegates: (workspaceSlug: string, agentId: string) => [...agentKeys.detail(workspaceSlug, agentId), "delegates"] as const,
};

/** Shared query definitions so server prefetch and client hooks agree on keys. */
export const agentQueries = {
  list: (workspaceSlug: string, filters: AgentListFilters) =>
    queryOptions({
      queryKey: agentKeys.list(workspaceSlug, filters),
      queryFn: () => agentsApi.list(workspaceSlug, filters),
    }),
  detail: (workspaceSlug: string, agentId: string) =>
    queryOptions({
      queryKey: agentKeys.detail(workspaceSlug, agentId),
      queryFn: () => agentsApi.get(workspaceSlug, agentId),
    }),
  knowledge: (workspaceSlug: string, agentId: string) =>
    queryOptions({
      queryKey: agentKeys.knowledge(workspaceSlug, agentId),
      queryFn: () => agentsApi.knowledgeOptions(workspaceSlug, agentId),
    }),
  overview: (workspaceSlug: string, agentId: string) =>
    queryOptions({
      queryKey: agentKeys.overview(workspaceSlug, agentId),
      queryFn: () => agentsApi.overview(workspaceSlug, agentId),
    }),
  delegates: (workspaceSlug: string, agentId: string) =>
    queryOptions({
      queryKey: agentKeys.delegates(workspaceSlug, agentId),
      queryFn: () => agentsApi.delegationCandidates(workspaceSlug, agentId),
    }),
};

export function useAgentsQuery(filters: AgentListFilters) {
  const { membership } = useWorkspace();
  return useQuery({ ...agentQueries.list(membership.workspace.slug, filters), placeholderData: (previous) => previous });
}

export function useAgentQuery(agentId: string) {
  const { membership } = useWorkspace();
  return useQuery(agentQueries.detail(membership.workspace.slug, agentId));
}

export function useAgentKnowledgeQuery(agentId: string) {
  const { membership } = useWorkspace();
  return useQuery(agentQueries.knowledge(membership.workspace.slug, agentId));
}

export function useAgentDelegatesQuery(agentId: string) {
  const { membership } = useWorkspace();
  return useQuery(agentQueries.delegates(membership.workspace.slug, agentId));
}

export function useAgentOverviewQuery(agentId: string) {
  const { membership } = useWorkspace();
  return useQuery(agentQueries.overview(membership.workspace.slug, agentId));
}
