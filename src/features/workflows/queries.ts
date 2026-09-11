import { queryOptions, useQuery } from "@tanstack/react-query";

import { workflowsApi } from "@/features/workflows/api";
import type { WorkflowListFilters, WorkflowRunListFilters } from "@/features/workflows/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";

export const workflowKeys = {
  all: (workspaceSlug: string) => ["workspaces", workspaceSlug, "workflows"] as const,
  lists: (workspaceSlug: string) => [...workflowKeys.all(workspaceSlug), "list"] as const,
  list: (workspaceSlug: string, filters: WorkflowListFilters) => [...workflowKeys.lists(workspaceSlug), filters] as const,
  detail: (workspaceSlug: string, workflowId: string) => [...workflowKeys.all(workspaceSlug), "detail", workflowId] as const,
  runLists: (workspaceSlug: string, workflowId: string) => [...workflowKeys.detail(workspaceSlug, workflowId), "runs"] as const,
  runList: (workspaceSlug: string, workflowId: string, filters: WorkflowRunListFilters) =>
    [...workflowKeys.runLists(workspaceSlug, workflowId), filters] as const,
  run: (workspaceSlug: string, workflowId: string, runId: string) =>
    [...workflowKeys.detail(workspaceSlug, workflowId), "run", runId] as const,
};

/** Shared query definitions so server prefetch and client hooks agree on keys. */
export const workflowQueries = {
  list: (workspaceSlug: string, filters: WorkflowListFilters) =>
    queryOptions({
      queryKey: workflowKeys.list(workspaceSlug, filters),
      queryFn: () => workflowsApi.list(workspaceSlug, filters),
    }),
  detail: (workspaceSlug: string, workflowId: string) =>
    queryOptions({
      queryKey: workflowKeys.detail(workspaceSlug, workflowId),
      queryFn: () => workflowsApi.get(workspaceSlug, workflowId),
    }),
  runs: (workspaceSlug: string, workflowId: string, filters: WorkflowRunListFilters) =>
    queryOptions({
      queryKey: workflowKeys.runList(workspaceSlug, workflowId, filters),
      queryFn: () => workflowsApi.listRuns(workspaceSlug, workflowId, filters),
    }),
  run: (workspaceSlug: string, workflowId: string, runId: string) =>
    queryOptions({
      queryKey: workflowKeys.run(workspaceSlug, workflowId, runId),
      queryFn: () => workflowsApi.getRun(workspaceSlug, workflowId, runId),
    }),
};

export function useWorkflowsQuery(filters: WorkflowListFilters) {
  const { membership } = useWorkspace();
  return useQuery({
    ...workflowQueries.list(membership.workspace.slug, filters),
    placeholderData: (previous) => previous,
  });
}

export function useWorkflowQuery(workflowId: string) {
  const { membership } = useWorkspace();
  return useQuery(workflowQueries.detail(membership.workspace.slug, workflowId));
}

export function useWorkflowRunsQuery(workflowId: string, filters: WorkflowRunListFilters) {
  const { membership } = useWorkspace();
  return useQuery({
    ...workflowQueries.runs(membership.workspace.slug, workflowId, filters),
    placeholderData: (previous) => previous,
  });
}

export function useWorkflowRunQuery(workflowId: string, runId: string) {
  const { membership } = useWorkspace();
  return useQuery(workflowQueries.run(membership.workspace.slug, workflowId, runId));
}
