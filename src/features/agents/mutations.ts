import { useMutation, useQueryClient } from "@tanstack/react-query";

import { agentsApi } from "@/features/agents/api";
import { agentKeys } from "@/features/agents/queries";
import type { CreateAgentInput, UpdateAgentInput } from "@/features/agents/schemas";
import type { Agent } from "@/features/agents/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { isApiError } from "@/lib/api/api-error";
import { toast } from "@/stores/toast-store";

function errorMessage(error: unknown, fallback: string): string {
  return isApiError(error) ? error.message : fallback;
}

export function useCreateAgentMutation() {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useMutation({
    mutationFn: (input: CreateAgentInput) => agentsApi.create(slug, input),
    onSuccess: (agent) => {
      queryClient.setQueryData(agentKeys.detail(slug, agent.id), agent);
      void queryClient.invalidateQueries({ queryKey: agentKeys.lists(slug) });
      toast.success({ title: "Agent created", description: `${agent.name} is ready to configure.` });
    },
    onError: (error) => toast.error({ title: "Could not create agent", description: errorMessage(error, "Please try again.") }),
  });
}

export function useUpdateAgentMutation(agentId: string, options: { silent?: boolean } = {}) {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  const detailKey = agentKeys.detail(slug, agentId);

  return useMutation({
    mutationFn: (input: UpdateAgentInput) => agentsApi.update(slug, agentId, input),
    onMutate: async (input) => {
      // Optimistic update for lightweight fields (status, name) so toggles feel instant.
      await queryClient.cancelQueries({ queryKey: detailKey });
      const previous = queryClient.getQueryData<Agent>(detailKey);
      if (previous && (input.status || input.name)) {
        queryClient.setQueryData<Agent>(detailKey, {
          ...previous,
          ...(input.status ? { status: input.status } : {}),
          ...(input.name ? { name: input.name } : {}),
        });
      }
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(detailKey, context.previous);
      toast.error({ title: "Could not save changes", description: errorMessage(error, "Please try again.") });
    },
    onSuccess: (agent) => {
      queryClient.setQueryData(detailKey, agent);
      void queryClient.invalidateQueries({ queryKey: agentKeys.lists(slug) });
      void queryClient.invalidateQueries({ queryKey: agentKeys.knowledge(slug, agentId) });
      if (!options.silent) toast.success("Changes saved");
    },
  });
}

export function useDeleteAgentMutation() {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useMutation({
    mutationFn: (agentId: string) => agentsApi.remove(slug, agentId),
    onSuccess: (_result, agentId) => {
      queryClient.removeQueries({ queryKey: agentKeys.detail(slug, agentId) });
      void queryClient.invalidateQueries({ queryKey: agentKeys.lists(slug) });
      toast.success("Agent deleted");
    },
    onError: (error) => toast.error({ title: "Could not delete agent", description: errorMessage(error, "Please try again.") }),
  });
}
