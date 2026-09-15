import { useMutation, useQueryClient } from "@tanstack/react-query";

import { billingApi } from "@/features/billing/api";
import { billingKeys } from "@/features/billing/queries";
import type { AssignPlanInput } from "@/features/billing/schemas";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { isApiError } from "@/lib/api/api-error";
import { toast } from "@/stores/toast-store";

function errorMessage(error: unknown, fallback: string): string {
  // The service refuses with an explanation ("Only an owner can change this
  // workspace's plan"); showing it is why it is returned as the 403 message.
  return isApiError(error) ? error.message : fallback;
}

/**
 * Both writes return the whole overview - the entitlement table changes
 * wholesale when the plan does - so the cache is replaced rather than patched.
 */
export function useAssignPlanMutation() {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useMutation({
    mutationFn: (input: AssignPlanInput) => billingApi.assignPlan(slug, input),
    onSuccess: (overview) => {
      queryClient.setQueryData(billingKeys.overview(slug), overview);
      toast.success({
        title: "Plan updated",
        description: overview.subscription?.planName
          ? `This workspace is on ${overview.subscription.planName}.`
          : "The plan assignment was saved.",
      });
    },
    onError: (error) =>
      toast.error({ title: "Could not update the plan", description: errorMessage(error, "Please try again.") }),
  });
}

export function useClearPlanMutation() {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useMutation({
    mutationFn: () => billingApi.clearPlan(slug),
    onSuccess: (overview) => {
      queryClient.setQueryData(billingKeys.overview(slug), overview);
      toast.success({
        title: "Plan removed",
        description: "This workspace is unassigned again, and nothing is enforced.",
      });
    },
    onError: (error) =>
      toast.error({ title: "Could not remove the plan", description: errorMessage(error, "Please try again.") }),
  });
}
