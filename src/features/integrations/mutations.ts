import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiKeysApi, integrationsApi } from "@/features/integrations/api";
import { integrationKeys } from "@/features/integrations/queries";
import type { ConnectIntegrationInput, CreateApiKeyInput } from "@/features/integrations/schemas";
import type { Integration, IntegrationProvider } from "@/features/integrations/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { isApiError } from "@/lib/api/api-error";
import { toast } from "@/stores/toast-store";

function errorMessage(error: unknown, fallback: string): string {
  return isApiError(error) ? error.message : fallback;
}

export function useConnectIntegrationMutation(provider: IntegrationProvider) {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useMutation({
    mutationFn: (input: ConnectIntegrationInput) => integrationsApi.connect(slug, provider, input),
    onSuccess: (integration) => {
      queryClient.setQueryData<Integration[]>(integrationKeys.list(slug), (previous) =>
        previous
          ? [...previous.filter((item) => item.provider !== provider), integration]
          : [integration],
      );
      toast.success({ title: "Saved", description: `${integration.name} is connected.` });
    },
    onError: (error) => toast.error({ title: "Could not save", description: errorMessage(error, "Please try again.") }),
  });
}

export function useDisconnectIntegrationMutation() {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useMutation({
    mutationFn: (provider: IntegrationProvider) => integrationsApi.disconnect(slug, provider),
    onSuccess: (_result, provider) => {
      queryClient.setQueryData<Integration[]>(integrationKeys.list(slug), (previous) =>
        previous ? previous.filter((item) => item.provider !== provider) : previous,
      );
      toast.success({ title: "Disconnected", description: "The stored credentials were deleted." });
    },
    onError: (error) => toast.error({ title: "Could not disconnect", description: errorMessage(error, "Please try again.") }),
  });
}

export function useTestIntegrationMutation() {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useMutation({
    mutationFn: (provider: IntegrationProvider) => integrationsApi.test(slug, provider),
    onSuccess: (result) => {
      queryClient.setQueryData<Integration[]>(integrationKeys.list(slug), (previous) =>
        previous
          ? previous.map((item) => (item.provider === result.integration.provider ? result.integration : item))
          : [result.integration],
      );
      // A failed test is a result, not a request failure: report it as a
      // warning so the operator sees the reason without an error toast.
      if (result.ok) toast.success({ title: "Connection test passed", description: result.message });
      else toast.warning({ title: "Connection test failed", description: result.message });
    },
    onError: (error) => toast.error({ title: "Could not run the test", description: errorMessage(error, "Please try again.") }),
  });
}

export function useCreateApiKeyMutation() {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useMutation({
    mutationFn: (input: CreateApiKeyInput) => apiKeysApi.create(slug, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: integrationKeys.apiKeys(slug) });
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
      void queryClient.invalidateQueries({ queryKey: integrationKeys.apiKeys(slug) });
      toast.success({ title: "Key revoked", description: `“${apiKey.name}” can no longer be used.` });
    },
    onError: (error) => toast.error({ title: "Could not revoke the key", description: errorMessage(error, "Please try again.") }),
  });
}
