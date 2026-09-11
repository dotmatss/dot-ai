export const KNOWLEDGE_BASE_STATUSES = ["empty", "processing", "ready", "error"] as const;
export type KnowledgeBaseStatus = (typeof KNOWLEDGE_BASE_STATUSES)[number];

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
 * How a knowledge base's content was vectorized. Stored on the row so a later
 * provider or dimension change is detectable per knowledge base instead of
 * silently mixing incompatible vectors.
 */
export interface KnowledgeEmbeddingConfig {
  provider: string;
  dimensions: number;
  chunkTargetTokens: number;
  chunkOverlapTokens: number;
}

export interface KnowledgeBaseSummary {
  id: string;
  name: string;
  description: string | null;
  status: KnowledgeBaseStatus;
  sourceCount: number;
  readySourceCount: number;
  failedSourceCount: number;
  chunkCount: number;
  tokenCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeBase extends KnowledgeBaseSummary {
  workspaceId: string;
  embeddingConfig: KnowledgeEmbeddingConfig;
  /** Chatbots and agents that would lose this knowledge base if it is deleted. */
  attachedChatbotCount: number;
  attachedAgentCount: number;
}

/** Non-secret ingestion details worth surfacing in the UI. */
export interface KnowledgeSourceMetadata {
  fileName?: string;
  contentType?: string;
  sizeBytes?: number;
  finalUrl?: string;
}

export interface KnowledgeSource {
  id: string;
  knowledgeBaseId: string;
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

export interface KnowledgeBaseListFilters {
  q?: string;
  status?: KnowledgeBaseStatus;
  page?: number;
  pageSize?: number;
}

export interface KnowledgeSourceListFilters {
  page?: number;
  pageSize?: number;
}
