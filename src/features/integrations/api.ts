import type { ConnectIntegrationInput, CreateApiKeyInput } from "@/features/integrations/schemas";
import type {
  ApiKey,
  ApiKeyListFilters,
  CreatedApiKey,
  Integration,
  IntegrationProvider,
  IntegrationTestResult,
} from "@/features/integrations/types";
import { apiFetch, buildQueryString } from "@/lib/api/http";
import type { Paginated } from "@/types/pagination";

const base = (workspaceSlug: string) => `/api/v1/w/${workspaceSlug}/integrations`;

/**
 * Client-side API surface. No method here can return secret material: the
 * server never puts it in a response, and nothing decrypts on this side.
 */
export const integrationsApi = {
  list: (workspaceSlug: string) => apiFetch<Integration[]>(base(workspaceSlug)),
  connect: (workspaceSlug: string, provider: IntegrationProvider, input: ConnectIntegrationInput) =>
    apiFetch<Integration>(`${base(workspaceSlug)}/providers/${provider}`, { method: "PUT", json: input }),
  disconnect: (workspaceSlug: string, provider: IntegrationProvider) =>
    apiFetch<void>(`${base(workspaceSlug)}/providers/${provider}`, { method: "DELETE" }),
  test: (workspaceSlug: string, provider: IntegrationProvider) =>
    apiFetch<IntegrationTestResult>(`${base(workspaceSlug)}/providers/${provider}/test`, { method: "POST" }),
};

export const apiKeysApi = {
  list: (workspaceSlug: string, filters: ApiKeyListFilters = {}) =>
    apiFetch<Paginated<ApiKey>>(`${base(workspaceSlug)}/api-keys${buildQueryString(filters)}`),
  create: (workspaceSlug: string, input: CreateApiKeyInput) =>
    apiFetch<CreatedApiKey>(`${base(workspaceSlug)}/api-keys`, { method: "POST", json: input }),
  revoke: (workspaceSlug: string, apiKeyId: string) =>
    apiFetch<ApiKey>(`${base(workspaceSlug)}/api-keys/${apiKeyId}`, { method: "DELETE" }),
};
