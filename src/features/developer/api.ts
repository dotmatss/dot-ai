import type { CreateApiKeyInput } from "@/features/developer/schemas";
import type { ApiKey, ApiKeyListFilters, CreatedApiKey } from "@/features/developer/types";
import { apiFetch, buildQueryString } from "@/lib/api/http";
import type { Paginated } from "@/types/pagination";

const base = (workspaceSlug: string) => `/api/v1/w/${workspaceSlug}/developer`;

export const apiKeysApi = {
  list: (workspaceSlug: string, filters: ApiKeyListFilters = {}) =>
    apiFetch<Paginated<ApiKey>>(`${base(workspaceSlug)}/api-keys${buildQueryString(filters)}`),
  create: (workspaceSlug: string, input: CreateApiKeyInput) =>
    apiFetch<CreatedApiKey>(`${base(workspaceSlug)}/api-keys`, { method: "POST", json: input }),
  revoke: (workspaceSlug: string, apiKeyId: string) =>
    apiFetch<ApiKey>(`${base(workspaceSlug)}/api-keys/${apiKeyId}`, { method: "DELETE" }),
};
