export const COLLECTION_STATUSES = ["empty", "processing", "ready", "error"] as const;
export type CollectionStatus = (typeof COLLECTION_STATUSES)[number];

export const KNOWLEDGE_SOURCE_TYPES = ["text", "url", "file"] as const;
export type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPES)[number];

/**
 * The full ingestion lifecycle. Every stage is persisted as the pipeline
 * advances so the UI can show real progress rather than a spinner.
 */
export const KNOWLEDGE_SOURCE_STATUSES = [
  "pending",
  "ingesting",
  "processing",
  "chunking",
  "embedding",
  "indexing",
  "ready",
  "failed",
] as const;
export type KnowledgeSourceStatus = (typeof KNOWLEDGE_SOURCE_STATUSES)[number];

/** Statuses that mean work is still owed on a source. */
export const KNOWLEDGE_SOURCE_ACTIVE_STATUSES = [
  "pending",
  "ingesting",
  "processing",
  "chunking",
  "embedding",
  "indexing",
] as const satisfies ReadonlyArray<KnowledgeSourceStatus>;

export function isSourceInFlight(status: KnowledgeSourceStatus): boolean {
  return (KNOWLEDGE_SOURCE_ACTIVE_STATUSES as readonly string[]).includes(status);
}

/**
 * How a source's content was vectorized. Stored on the source row, beside the
 * vectors it describes, so a later provider or dimension change is detectable
 * per document instead of silently mixing incompatible vectors.
 */
export interface KnowledgeEmbeddingConfig {
  provider: string;
  dimensions: number;
  chunkTargetTokens: number;
  chunkOverlapTokens: number;
}

/* -------------------------------------------------------------------------- */
/* Collections                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A collection is a logical grouping of sources, and only that. It carries no
 * retrieval settings: what an agent retrieves is decided by which collections
 * it is given, and how it retrieves is the agent's own configuration.
 *
 * `status` is a rollup of the sources inside it, recomputed by the pipeline.
 */
export interface CollectionSummary {
  id: string;
  name: string;
  description: string | null;
  status: CollectionStatus;
  sourceCount: number;
  readySourceCount: number;
  failedSourceCount: number;
  chunkCount: number;
  tokenCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Collection extends CollectionSummary {
  workspaceId: string;
  /** Chatbots and agents that would lose this grounding if it is deleted. */
  attachedChatbotCount: number;
  attachedAgentCount: number;
}

/* -------------------------------------------------------------------------- */
/* Sources                                                                    */
/* -------------------------------------------------------------------------- */

/** Non-secret ingestion details worth surfacing in the UI. */
export interface KnowledgeSourceMetadata {
  fileName?: string;
  contentType?: string;
  sizeBytes?: number;
  finalUrl?: string;
}

export interface KnowledgeSource {
  id: string;
  /** NULL means Unorganized: added and indexed, but not filed into a collection. */
  collectionId: string | null;
  /** Denormalized for listings that span collections; NULL when unorganized. */
  collectionName: string | null;
  type: KnowledgeSourceType;
  name: string;
  uri: string | null;
  status: KnowledgeSourceStatus;
  chunkCount: number;
  tokenCount: number;
  characterCount: number;
  /** Human-readable failure reason; only set when status is "failed". */
  error: string | null;
  /** Short excerpt of the extracted text; the full content is never shipped to the client. */
  contentPreview: string | null;
  metadata: KnowledgeSourceMetadata;
  createdAt: string;
  updatedAt: string;
}

/**
 * Which documents a listing covers.
 *
 * "unorganized" is deliberately its own kind rather than a collection id of
 * NULL passed around as a string: the distinction between "everything" and
 * "the things nobody has filed" is one an accidental `?? null` should not be
 * able to blur.
 */
export type KnowledgeScope =
  | { kind: "all" }
  | { kind: "unorganized" }
  | { kind: "collection"; collectionId: string };

export const KNOWLEDGE_SCOPE_ALL: KnowledgeScope = { kind: "all" };
export const KNOWLEDGE_SCOPE_UNORGANIZED: KnowledgeScope = { kind: "unorganized" };

export function collectionScope(collectionId: string): KnowledgeScope {
  return { kind: "collection", collectionId };
}

/**
 * Everything the Knowledge landing page shows, in one payload: the collections,
 * the most recently added documents across all of them, and how many are still
 * waiting to be filed.
 */
export interface KnowledgeOverview {
  collections: CollectionSummary[];
  collectionTotal: number;
  recentSources: KnowledgeSource[];
  unorganizedCount: number;
  totalSourceCount: number;
}

export interface CollectionListFilters {
  q?: string;
  status?: CollectionStatus;
  page?: number;
  pageSize?: number;
}

export interface KnowledgeSourceListFilters {
  q?: string;
  status?: KnowledgeSourceStatus;
  page?: number;
  pageSize?: number;
}
