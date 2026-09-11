import type {
  CreateKnowledgeBaseInput,
  CreateSourceInput,
  KnowledgeSearchInput,
  UpdateKnowledgeBaseInput,
} from "@/features/knowledge/schemas";
import type {
  KnowledgeBase,
  KnowledgeBaseListFilters,
  KnowledgeBaseSummary,
  KnowledgeSource,
  KnowledgeSourceListFilters,
} from "@/features/knowledge/types";
import { ApiError } from "@/lib/api/api-error";
import { apiFetch, buildQueryString, type ApiFailureEnvelope, type ApiSuccessEnvelope } from "@/lib/api/http";
import type { RetrievedSource } from "@/types/ai";
import type { Paginated } from "@/types/pagination";

const base = (workspaceSlug: string) => `/api/v1/w/${workspaceSlug}/knowledge`;
const detail = (workspaceSlug: string, knowledgeBaseId: string) => `${base(workspaceSlug)}/${knowledgeBaseId}`;

export interface KnowledgeSearchResponse {
  query: string;
  results: RetrievedSource[];
}

/**
 * `apiFetch` only sends JSON bodies, and a multipart upload must let the
 * browser generate the boundary. This keeps the same envelope and error
 * handling for the one endpoint that needs raw FormData.
 */
async function postFormData<T>(path: string, body: FormData): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    // Same CSRF marker apiFetch sends; workspaceRoute rejects requests without it.
    headers: { Accept: "application/json", "X-Requested-With": "fetch" },
    body,
  });

  let payload: unknown = null;
  if ((response.headers.get("content-type") ?? "").includes("application/json")) {
    payload = await response.json().catch(() => null);
  }
  if (!response.ok) {
    throw ApiError.fromPayload(response.status, (payload as ApiFailureEnvelope | null)?.error);
  }
  return (payload as ApiSuccessEnvelope<T>).data;
}

/** Client-side API surface for the knowledge domain. */
export const knowledgeApi = {
  list: (workspaceSlug: string, filters: KnowledgeBaseListFilters = {}) =>
    apiFetch<Paginated<KnowledgeBaseSummary>>(`${base(workspaceSlug)}${buildQueryString(filters)}`),
  get: (workspaceSlug: string, knowledgeBaseId: string) =>
    apiFetch<KnowledgeBase>(detail(workspaceSlug, knowledgeBaseId)),
  create: (workspaceSlug: string, input: CreateKnowledgeBaseInput) =>
    apiFetch<KnowledgeBase>(base(workspaceSlug), { method: "POST", json: input }),
  update: (workspaceSlug: string, knowledgeBaseId: string, input: UpdateKnowledgeBaseInput) =>
    apiFetch<KnowledgeBase>(detail(workspaceSlug, knowledgeBaseId), { method: "PATCH", json: input }),
  remove: (workspaceSlug: string, knowledgeBaseId: string) =>
    apiFetch<void>(detail(workspaceSlug, knowledgeBaseId), { method: "DELETE" }),
  reprocess: (workspaceSlug: string, knowledgeBaseId: string) =>
    apiFetch<KnowledgeBase>(`${detail(workspaceSlug, knowledgeBaseId)}/reprocess`, { method: "POST" }),
  search: (workspaceSlug: string, knowledgeBaseId: string, input: KnowledgeSearchInput) =>
    apiFetch<KnowledgeSearchResponse>(`${detail(workspaceSlug, knowledgeBaseId)}/search`, { method: "POST", json: input }),

  listSources: (workspaceSlug: string, knowledgeBaseId: string, filters: KnowledgeSourceListFilters = {}) =>
    apiFetch<Paginated<KnowledgeSource>>(`${detail(workspaceSlug, knowledgeBaseId)}/sources${buildQueryString(filters)}`),
  createSource: (workspaceSlug: string, knowledgeBaseId: string, input: CreateSourceInput) =>
    apiFetch<KnowledgeSource>(`${detail(workspaceSlug, knowledgeBaseId)}/sources`, { method: "POST", json: input }),
  uploadSource: (workspaceSlug: string, knowledgeBaseId: string, file: File) => {
    const body = new FormData();
    body.set("file", file);
    return postFormData<KnowledgeSource>(`${detail(workspaceSlug, knowledgeBaseId)}/sources/upload`, body);
  },
  removeSource: (workspaceSlug: string, knowledgeBaseId: string, sourceId: string) =>
    apiFetch<void>(`${detail(workspaceSlug, knowledgeBaseId)}/sources/${sourceId}`, { method: "DELETE" }),
  reprocessSource: (workspaceSlug: string, knowledgeBaseId: string, sourceId: string) =>
    apiFetch<KnowledgeSource>(`${detail(workspaceSlug, knowledgeBaseId)}/sources/${sourceId}/reprocess`, {
      method: "POST",
    }),
};
