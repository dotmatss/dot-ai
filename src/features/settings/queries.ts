import { queryOptions, useQuery } from "@tanstack/react-query";

import { settingsApi } from "@/features/settings/api";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";

/**
 * Keys are workspace-scoped even for the two personal surfaces (profile and
 * sessions): the pages live inside a workspace, and scoping the cache to the
 * slug means switching workspaces cannot show a stale panel from another one.
 */
export const settingsKeys = {
  all: (workspaceSlug: string) => ["workspaces", workspaceSlug, "settings"] as const,
  general: (workspaceSlug: string) => [...settingsKeys.all(workspaceSlug), "general"] as const,
  members: (workspaceSlug: string) => [...settingsKeys.all(workspaceSlug), "members"] as const,
  sessions: (workspaceSlug: string) => [...settingsKeys.all(workspaceSlug), "sessions"] as const,
  profile: (workspaceSlug: string) => [...settingsKeys.all(workspaceSlug), "profile"] as const,
};

/** Shared definitions so server prefetch and client hooks agree on keys. */
export const settingsQueries = {
  general: (workspaceSlug: string) =>
    queryOptions({
      queryKey: settingsKeys.general(workspaceSlug),
      queryFn: () => settingsApi.general(workspaceSlug),
    }),
  members: (workspaceSlug: string) =>
    queryOptions({
      queryKey: settingsKeys.members(workspaceSlug),
      queryFn: () => settingsApi.members(workspaceSlug),
    }),
  sessions: (workspaceSlug: string) =>
    queryOptions({
      queryKey: settingsKeys.sessions(workspaceSlug),
      queryFn: () => settingsApi.sessions(workspaceSlug),
    }),
  profile: (workspaceSlug: string) =>
    queryOptions({
      queryKey: settingsKeys.profile(workspaceSlug),
      queryFn: () => settingsApi.profile(workspaceSlug),
    }),
};

export function useWorkspaceGeneralQuery() {
  const { membership } = useWorkspace();
  return useQuery(settingsQueries.general(membership.workspace.slug));
}

export function useMembersQuery() {
  const { membership } = useWorkspace();
  return useQuery(settingsQueries.members(membership.workspace.slug));
}

export function useUserSessionsQuery() {
  const { membership } = useWorkspace();
  return useQuery(settingsQueries.sessions(membership.workspace.slug));
}

export function useUserProfileQuery() {
  const { membership } = useWorkspace();
  return useQuery(settingsQueries.profile(membership.workspace.slug));
}
