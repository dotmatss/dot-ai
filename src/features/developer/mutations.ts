import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiKeysApi } from "@/features/developer/api";
import { developerKeys } from "@/features/developer/queries";
import type { CreateApiKeyInput } from "@/features/developer/schemas";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { isApiError } from "@/lib/api/api-error";
import { toast } from "@/stores/toast-store";

function errorMessage(error: unknown, fallback: string): string {
  return isApiError(error) ? error.message : fallback;
}

export function useCreateApiKeyMutation() {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useMutation({
    mutationFn: (input: CreateApiKeyInput) => apiKeysApi.create(slug, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: developerKeys.apiKeys(slug) });
    },
    onError: (error) => toast.error({ title: "Could not create the key", description: errorMessage(error, "Please try again.") }),
  });
}

export function useRevokeApiKeyMutation() {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useMutation({
    mutationFn: (apiKeyId: string) => apiKeysApi.revoke(slug, apiKeyId),
    onSuccess: (apiKey) => {
      void queryClient.invalidateQueries({ queryKey: developerKeys.apiKeys(slug) });
      toast.success({ title: "Key revoked", description: `“${apiKey.name}” can no longer be used.` });
    },
    onError: (error) => toast.error({ title: "Could not revoke the key", description: errorMessage(error, "Please try again.") }),
  });
}
