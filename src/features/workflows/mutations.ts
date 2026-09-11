import { useMutation, useQueryClient } from "@tanstack/react-query";

import { workflowsApi } from "@/features/workflows/api";
import { workflowKeys } from "@/features/workflows/queries";
import type { CreateWorkflowInput, StartWorkflowRunInput, UpdateWorkflowInput } from "@/features/workflows/schemas";
import type { Workflow } from "@/features/workflows/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { isApiError } from "@/lib/api/api-error";
import { toast } from "@/stores/toast-store";

function errorMessage(error: unknown, fallback: string): string {
  return isApiError(error) ? error.message : fallback;
}

export function useCreateWorkflowMutation() {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useMutation({
    mutationFn: (input: CreateWorkflowInput) => workflowsApi.create(slug, input),
    onSuccess: (workflow) => {
      queryClient.setQueryData(workflowKeys.detail(slug, workflow.id), workflow);
      void queryClient.invalidateQueries({ queryKey: workflowKeys.lists(slug) });
      toast.success({ title: "Workflow created", description: `${workflow.name} is ready to build.` });
    },
    onError: (error) =>
      toast.error({ title: "Could not create workflow", description: errorMessage(error, "Please try again.") }),
  });
}

export function useUpdateWorkflowMutation(workflowId: string, options: { silent?: boolean } = {}) {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  const detailKey = workflowKeys.detail(slug, workflowId);

  return useMutation({
    mutationFn: (input: UpdateWorkflowInput) => workflowsApi.update(slug, workflowId, input),
    onMutate: async (input) => {
      // Optimistic only for the cheap header fields so Activate/Pause feels instant.
      await queryClient.cancelQueries({ queryKey: detailKey });
      const previous = queryClient.getQueryData<Workflow>(detailKey);
      if (previous && (input.status || input.name)) {
        queryClient.setQueryData<Workflow>(detailKey, {
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
    onSuccess: (workflow) => {
      queryClient.setQueryData(detailKey, workflow);
      void queryClient.invalidateQueries({ queryKey: workflowKeys.lists(slug) });
      if (!options.silent) toast.success("Changes saved");
    },
  });
}

export function useDeleteWorkflowMutation() {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useMutation({
    mutationFn: (workflowId: string) => workflowsApi.remove(slug, workflowId),
    onSuccess: (_result, workflowId) => {
      queryClient.removeQueries({ queryKey: workflowKeys.detail(slug, workflowId) });
      void queryClient.invalidateQueries({ queryKey: workflowKeys.lists(slug) });
      toast.success("Workflow deleted");
    },
    onError: (error) =>
      toast.error({ title: "Could not delete workflow", description: errorMessage(error, "Please try again.") }),
  });
}

export function useStartWorkflowRunMutation(workflowId: string) {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useMutation({
    mutationFn: (input: StartWorkflowRunInput) => workflowsApi.startRun(slug, workflowId, input),
    onSuccess: (run) => {
      queryClient.setQueryData(workflowKeys.run(slug, workflowId, run.id), run);
      void queryClient.invalidateQueries({ queryKey: workflowKeys.runLists(slug, workflowId) });
      // The workflow summary carries the last run status.
      void queryClient.invalidateQueries({ queryKey: workflowKeys.detail(slug, workflowId) });
      void queryClient.invalidateQueries({ queryKey: workflowKeys.lists(slug) });
      if (run.status === "succeeded") toast.success({ title: "Run finished", description: "Every step succeeded." });
      else toast.error({ title: "Run failed", description: run.error ?? "A step failed. Open the run for details." });
    },
    onError: (error) => toast.error({ title: "Could not start the run", description: errorMessage(error, "Please try again.") }),
  });
}
