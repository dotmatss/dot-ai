import type {
  ConnectIntegrationInput,
  CreateCredentialInput,
  UpdateCredentialInput,
} from "@/features/integrations/schemas";
import type {
  Credential,
  CredentialListFilters,
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

/**
 * Outbound credentials. Note what is missing: there is no `get secret` call,
 * because no endpoint returns one. Editing sends new values; it never receives
 * the current ones.
 */
export const credentialsApi = {
  list: (workspaceSlug: string, filters: CredentialListFilters = {}) =>
    apiFetch<Paginated<Credential>>(`${base(workspaceSlug)}/credentials${buildQueryString(filters)}`),
  create: (workspaceSlug: string, input: CreateCredentialInput) =>
    apiFetch<Credential>(`${base(workspaceSlug)}/credentials`, { method: "POST", json: input }),
  update: (workspaceSlug: string, credentialId: string, input: UpdateCredentialInput) =>
    apiFetch<Credential>(`${base(workspaceSlug)}/credentials/${credentialId}`, { method: "PATCH", json: input }),
  remove: (workspaceSlug: string, credentialId: string) =>
    apiFetch<void>(`${base(workspaceSlug)}/credentials/${credentialId}`, { method: "DELETE" }),
};
