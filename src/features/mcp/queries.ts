import { useQuery } from "@tanstack/react-query";

import { mcpApi } from "@/features/mcp/api";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";

/** Key factory, matching the per-feature convention. */
export const mcpKeys = {
  all: (slug: string) => ["mcp", slug] as const,
  servers: (slug: string) => [...mcpKeys.all(slug), "servers"] as const,
  server: (slug: string, serverId: string) => [...mcpKeys.servers(slug), serverId] as const,
  tools: (slug: string, serverId: string) => [...mcpKeys.server(slug, serverId), "tools"] as const,
  attachable: (slug: string) => [...mcpKeys.all(slug), "attachable"] as const,
  approvals: (slug: string) => [...mcpKeys.all(slug), "approvals"] as const,
  calls: (slug: string) => [...mcpKeys.all(slug), "calls"] as const,
};

export function useMcpServersQuery() {
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useQuery({ queryKey: mcpKeys.servers(slug), queryFn: () => mcpApi.listServers(slug) });
}

export function useMcpServerQuery(serverId: string) {
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useQuery({ queryKey: mcpKeys.server(slug, serverId), queryFn: () => mcpApi.getServer(slug, serverId) });
}

export function useMcpToolsQuery(serverId: string) {
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useQuery({ queryKey: mcpKeys.tools(slug, serverId), queryFn: () => mcpApi.listTools(slug, serverId) });
}

/**
 * The approvals queue.
 *
 * Polled, because a call appears here when an agent turn asks for it rather
 * than when this page does anything. Thirty seconds is short enough that a
 * waiting agent is not forgotten and long enough not to be a busy loop.
 */
export function useMcpApprovalsQuery() {
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useQuery({
    queryKey: mcpKeys.approvals(slug),
    queryFn: () => mcpApi.listApprovals(slug),
    refetchInterval: 30_000,
  });
}

export function useMcpCallsQuery(limit = 50) {
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useQuery({ queryKey: mcpKeys.calls(slug), queryFn: () => mcpApi.listCalls(slug, limit) });
}

/** The approved tools an agent could be given. */
export function useAttachableMcpToolsQuery() {
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useQuery({ queryKey: mcpKeys.attachable(slug), queryFn: () => mcpApi.listAttachable(slug) });
}
