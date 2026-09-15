import { useMutation, useQueryClient } from "@tanstack/react-query";

import { credentialsApi, integrationsApi } from "@/features/integrations/api";
import { integrationKeys } from "@/features/integrations/queries";
import type {
  ConnectIntegrationInput,
  CreateCredentialInput,
  UpdateCredentialInput,
} from "@/features/integrations/schemas";
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

/**
 * Credential mutations invalidate rather than patch the cache: the list is
 * ordered and paginated server-side, and a name change can move a row. There is
 * nothing secret to keep out of the cache because the response never carries
 * any - the toast and the row both describe the credential, not its value.
 */
export function useCreateCredentialMutation() {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useMutation({
    mutationFn: (input: CreateCredentialInput) => credentialsApi.create(slug, input),
    onSuccess: (credential) => {
      void queryClient.invalidateQueries({ queryKey: integrationKeys.credentials(slug) });
      toast.success({ title: "Credential saved", description: `“${credential.name}” is ready to use in a workflow.` });
    },
    onError: (error) =>
      toast.error({ title: "Could not save the credential", description: errorMessage(error, "Please try again.") }),
  });
}

export function useUpdateCredentialMutation() {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useMutation({
    mutationFn: ({ credentialId, input }: { credentialId: string; input: UpdateCredentialInput }) =>
      credentialsApi.update(slug, credentialId, input),
    onSuccess: (credential) => {
      void queryClient.invalidateQueries({ queryKey: integrationKeys.credentials(slug) });
      toast.success({ title: "Credential updated", description: `“${credential.name}” was saved.` });
    },
    onError: (error) =>
      toast.error({ title: "Could not update the credential", description: errorMessage(error, "Please try again.") }),
  });
}

export function useDeleteCredentialMutation() {
  const queryClient = useQueryClient();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  return useMutation({
    mutationFn: (credentialId: string) => credentialsApi.remove(slug, credentialId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: integrationKeys.credentials(slug) });
      toast.success({ title: "Credential deleted", description: "The stored value was destroyed." });
    },
    onError: (error) =>
      toast.error({ title: "Could not delete the credential", description: errorMessage(error, "Please try again.") }),
  });
}
