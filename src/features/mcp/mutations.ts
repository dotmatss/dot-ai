import { useMutation, useQueryClient } from "@tanstack/react-query";

import { mcpApi } from "@/features/mcp/api";
import { mcpKeys } from "@/features/mcp/queries";
import type { CreateMcpServerInput, SetMcpGrantsInput, UpdateMcpServerInput } from "@/features/mcp/schemas";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { isApiError } from "@/lib/api/api-error";
import { toast } from "@/stores/toast-store";

function errorMessage(error: unknown, fallback: string): string {
  return isApiError(error) ? error.message : fallback;
}

export function useCreateMcpServerMutation() {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;

  return useMutation({
    mutationFn: (input: CreateMcpServerInput) => mcpApi.createServer(slug, input),
    onSuccess: (server) => {
      void queryClient.invalidateQueries({ queryKey: mcpKeys.servers(slug) });
      toast.success({
        title: "MCP server connected",
        description: `Test the connection to discover what “${server.name}” offers.`,
      });
    },
    onError: (error) => toast.error({ title: "Could not connect that server", description: errorMessage(error, "Please try again.") }),
  });
}

export function useUpdateMcpServerMutation(serverId: string) {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;

  return useMutation({
    mutationFn: (input: UpdateMcpServerInput) => mcpApi.updateServer(slug, serverId, input),
    onSuccess: (server) => {
      queryClient.setQueryData(mcpKeys.server(slug, serverId), server);
      void queryClient.invalidateQueries({ queryKey: mcpKeys.servers(slug) });
      toast.success({ title: "Saved" });
    },
    onError: (error) => toast.error({ title: "Could not save", description: errorMessage(error, "Please try again.") }),
  });
}

export function useDeleteMcpServerMutation() {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;

  return useMutation({
    mutationFn: (serverId: string) => mcpApi.deleteServer(slug, serverId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mcpKeys.servers(slug) });
      toast.success({ title: "Disconnected", description: "Its tools are no longer available to any agent." });
    },
    onError: (error) => toast.error({ title: "Could not disconnect", description: errorMessage(error, "Please try again.") }),
  });
}

export function useProbeMcpServerMutation(serverId: string) {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;

  return useMutation({
    mutationFn: () => mcpApi.probe(slug, serverId),
    onSuccess: (outcome) => {
      void queryClient.invalidateQueries({ queryKey: mcpKeys.servers(slug) });
      if (outcome.ok) toast.success({ title: "Connection succeeded", description: outcome.message });
      else toast.error({ title: "Connection failed", description: outcome.message });
    },
    onError: (error) => toast.error({ title: "Could not test the connection", description: errorMessage(error, "Please try again.") }),
  });
}

/**
 * Refreshes the tool list.
 *
 * The toast reports stale approvals explicitly rather than only the tool
 * count, because a tool that changed since it was approved is the one thing a
 * person needs to act on after a refresh.
 */
export function useDiscoverMcpToolsMutation(serverId: string) {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;

  return useMutation({
    mutationFn: () => mcpApi.discover(slug, serverId),
    onSuccess: (outcome) => {
      void queryClient.invalidateQueries({ queryKey: mcpKeys.all(slug) });
      if (!outcome.ok) {
        toast.error({ title: "Could not read the tool list", description: outcome.message });
        return;
      }
      const stale = outcome.tools.filter((view) => view.stale).length;
      if (stale > 0) toast.warning({ title: "Approvals need reviewing", description: outcome.message });
      else toast.success({ title: "Tool list refreshed", description: outcome.message });
    },
    onError: (error) => toast.error({ title: "Could not refresh", description: errorMessage(error, "Please try again.") }),
  });
}

export function useSetMcpGrantsMutation(serverId: string) {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;

  return useMutation({
    mutationFn: (input: SetMcpGrantsInput) => mcpApi.setGrants(slug, serverId, input),
    onSuccess: (tools) => {
      queryClient.setQueryData(mcpKeys.tools(slug, serverId), tools);
      void queryClient.invalidateQueries({ queryKey: mcpKeys.servers(slug) });
      const granted = tools.filter((view) => view.grant).length;
      toast.success({
        title: "Approvals saved",
        description:
          granted === 0
            ? "No tools are approved, so this server offers nothing to your agents."
            : `${granted} tool${granted === 1 ? "" : "s"} approved.`,
      });
    },
    onError: (error) => toast.error({ title: "Could not save approvals", description: errorMessage(error, "Please try again.") }),
  });
}

/**
 * Approves or denies one queued call.
 *
 * The toast distinguishes three outcomes, not two. Approving does not
 * guarantee the call runs: it is re-checked first, and a grant revoked while
 * the call was waiting means it is refused even though a person said yes.
 */
export function useDecideMcpCallMutation() {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;

  return useMutation({
    mutationFn: ({ callId, decision }: { callId: string; decision: "approve" | "deny" }) =>
      mcpApi.decideCall(slug, callId, decision),
    onSuccess: (call) => {
      void queryClient.invalidateQueries({ queryKey: mcpKeys.approvals(slug) });
      void queryClient.invalidateQueries({ queryKey: mcpKeys.calls(slug) });

      if (call.status === "denied") {
        toast.success({ title: "Denied", description: `${call.toolName} was not run.` });
        return;
      }
      if (call.status === "refused") {
        toast.warning({
          title: "No longer allowed",
          description: call.errorMessage ?? `${call.toolName} could not be run.`,
        });
        return;
      }
      if (call.status === "failed") {
        toast.error({ title: "The call failed", description: call.errorMessage ?? `${call.toolName} could not be completed.` });
        return;
      }
      toast.success({
        title: call.isError ? "Ran, with an error" : "Approved and ran",
        description: call.isError ? `${call.toolName} reported an error.` : `${call.toolName} completed.`,
      });
    },
    onError: (error) => toast.error({ title: "Could not decide that call", description: errorMessage(error, "Please try again.") }),
  });
}

/**
 * Starts an OAuth authorization and sends the person to the server.
 *
 * A full navigation rather than a popup or a fetch-followed redirect: the
 * consent screen belongs to a third party, and the browser has to own it. The
 * flow comes back to our callback, which redirects here again.
 */
export function useAuthorizeMcpServerMutation(serverId: string) {
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;

  return useMutation({
    mutationFn: () => mcpApi.authorize(slug, serverId),
    onSuccess: ({ authorizationUrl }) => {
      window.location.assign(authorizationUrl);
    },
    onError: (error) =>
      toast.error({
        title: "Could not start the authorization",
        description: errorMessage(error, "The server may not support OAuth."),
      }),
  });
}

export function useRevokeMcpOauthMutation(serverId: string) {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;

  return useMutation({
    mutationFn: () => mcpApi.revokeAuthorization(slug, serverId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mcpKeys.all(slug) });
      toast.success({
        title: "Authorization removed",
        description: "This server needs authorizing again before its tools can be used.",
      });
    },
    onError: (error) => toast.error({ title: "Could not remove it", description: errorMessage(error, "Please try again.") }),
  });
}
