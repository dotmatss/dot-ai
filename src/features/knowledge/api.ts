import type {
  CreateCollectionInput,
  CreateSourceInput,
  KnowledgeSearchInput,
  MoveSourceInput,
  UpdateCollectionInput,
} from "@/features/knowledge/schemas";
import type {
  Collection,
  CollectionListFilters,
  CollectionSummary,
  KnowledgeOverview,
  KnowledgeScope,
  KnowledgeSource,
  KnowledgeSourceListFilters,
} from "@/features/knowledge/types";
import { ApiError } from "@/lib/api/api-error";
import { apiFetch, buildQueryString, type ApiFailureEnvelope, type ApiSuccessEnvelope } from "@/lib/api/http";
import type { RetrievedSource } from "@/types/ai";
import type { Paginated } from "@/types/pagination";

const base = (workspaceSlug: string) => `/api/v1/w/${workspaceSlug}/knowledge`;
const collection = (workspaceSlug: string, collectionId: string) => `${base(workspaceSlug)}/collections/${collectionId}`;
const sources = (workspaceSlug: string) => `${base(workspaceSlug)}/sources`;
const source = (workspaceSlug: string, sourceId: string) => `${sources(workspaceSlug)}/${sourceId}`;

export interface KnowledgeSearchResponse {
  query: string;
  results: RetrievedSource[];
}

/** The scope as it travels in a query string. See `knowledgeScopeParamSchema`. */
export function scopeParam(scope: KnowledgeScope): string {
  return scope.kind === "collection" ? scope.collectionId : scope.kind;
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
  overview: (workspaceSlug: string) => apiFetch<KnowledgeOverview>(`${base(workspaceSlug)}/overview`),

  listCollections: (workspaceSlug: string, filters: CollectionListFilters = {}) =>
    apiFetch<Paginated<CollectionSummary>>(`${base(workspaceSlug)}/collections${buildQueryString(filters)}`),
  getCollection: (workspaceSlug: string, collectionId: string) =>
    apiFetch<Collection>(collection(workspaceSlug, collectionId)),
  createCollection: (workspaceSlug: string, input: CreateCollectionInput) =>
    apiFetch<Collection>(`${base(workspaceSlug)}/collections`, { method: "POST", json: input }),
  updateCollection: (workspaceSlug: string, collectionId: string, input: UpdateCollectionInput) =>
    apiFetch<Collection>(collection(workspaceSlug, collectionId), { method: "PATCH", json: input }),
  removeCollection: (workspaceSlug: string, collectionId: string) =>
    apiFetch<void>(collection(workspaceSlug, collectionId), { method: "DELETE" }),
  reprocessCollection: (workspaceSlug: string, collectionId: string) =>
    apiFetch<Collection>(`${collection(workspaceSlug, collectionId)}/reprocess`, { method: "POST" }),
  search: (workspaceSlug: string, collectionId: string, input: KnowledgeSearchInput) =>
    apiFetch<KnowledgeSearchResponse>(`${collection(workspaceSlug, collectionId)}/search`, { method: "POST", json: input }),
  collectionOptions: (workspaceSlug: string) =>
    apiFetch<Array<{ id: string; name: string }>>(`${base(workspaceSlug)}/collections/options`),

  listSources: (workspaceSlug: string, scope: KnowledgeScope, filters: KnowledgeSourceListFilters = {}) =>
    apiFetch<Paginated<KnowledgeSource>>(`${sources(workspaceSlug)}${buildQueryString({ ...filters, scope: scopeParam(scope) })}`),
  createSource: (workspaceSlug: string, collectionId: string | null, input: CreateSourceInput) =>
    apiFetch<KnowledgeSource>(`${sources(workspaceSlug)}${buildQueryString({ collectionId })}`, {
      method: "POST",
      json: input,
    }),
  uploadSource: (workspaceSlug: string, collectionId: string | null, file: File) => {
    const body = new FormData();
    body.set("file", file);
    if (collectionId) body.set("collectionId", collectionId);
    return postFormData<KnowledgeSource>(`${sources(workspaceSlug)}/upload`, body);
  },
  moveSource: (workspaceSlug: string, sourceId: string, input: MoveSourceInput) =>
    apiFetch<KnowledgeSource>(source(workspaceSlug, sourceId), { method: "PATCH", json: input }),
  removeSource: (workspaceSlug: string, sourceId: string) =>
    apiFetch<void>(source(workspaceSlug, sourceId), { method: "DELETE" }),
  reprocessSource: (workspaceSlug: string, sourceId: string) =>
    apiFetch<KnowledgeSource>(`${source(workspaceSlug, sourceId)}/reprocess`, { method: "POST" }),
};
