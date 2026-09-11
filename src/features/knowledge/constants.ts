import type { BadgeTone } from "@/components/ui/app-badge";
import { CHUNK_OVERLAP_TOKENS, CHUNK_TARGET_TOKENS } from "@/features/knowledge/chunking";
import type {
  KnowledgeBaseStatus,
  KnowledgeEmbeddingConfig,
  KnowledgeSourceStatus,
  KnowledgeSourceType,
} from "@/features/knowledge/types";

export const KNOWLEDGE_BASE_STATUS_META: Record<KnowledgeBaseStatus, { label: string; tone: BadgeTone; description: string }> = {
  empty: { label: "Empty", tone: "neutral", description: "No sources added yet." },
  processing: { label: "Processing", tone: "info", description: "Sources are being ingested and indexed." },
  ready: { label: "Ready", tone: "success", description: "All sources are indexed and available for retrieval." },
  error: { label: "Needs attention", tone: "danger", description: "One or more sources failed to process." },
};

/**
 * Lifecycle metadata. Tones stay neutral/info while work is in flight so the
 * table does not read as a wall of colour; only the terminal states are
 * semantic. Every badge is rendered with its label, never colour alone.
 */
export const KNOWLEDGE_SOURCE_STATUS_META: Record<KnowledgeSourceStatus, { label: string; tone: BadgeTone; description: string }> = {
  pending: { label: "Queued", tone: "neutral", description: "Waiting to be processed." },
  ingesting: { label: "Ingesting", tone: "info", description: "Reading the content from its origin." },
  processing: { label: "Processing", tone: "info", description: "Cleaning and normalizing the extracted text." },
  chunking: { label: "Chunking", tone: "info", description: "Splitting the text into overlapping passages." },
  embedding: { label: "Embedding", tone: "info", description: "Turning passages into vectors." },
  indexing: { label: "Indexing", tone: "info", description: "Writing passages to the retrieval index." },
  ready: { label: "Ready", tone: "success", description: "Indexed and available for retrieval." },
  failed: { label: "Failed", tone: "danger", description: "Processing stopped; see the error and try again." },
};

export const KNOWLEDGE_SOURCE_TYPE_META: Record<KnowledgeSourceType, { label: string; description: string }> = {
  text: { label: "Text", description: "Content pasted directly into the app." },
  url: { label: "URL", description: "A public web page fetched and converted to text." },
  file: { label: "File", description: "An uploaded UTF-8 text document." },
};

/**
 * Written to knowledge_bases.embedding_config at creation so each knowledge
 * base records how its vectors were produced.
 */
export const DEFAULT_EMBEDDING_CONFIG: KnowledgeEmbeddingConfig = {
  provider: "mock",
  dimensions: 256,
  chunkTargetTokens: CHUNK_TARGET_TOKENS,
  chunkOverlapTokens: CHUNK_OVERLAP_TOKENS,
};

export const KNOWLEDGE_SOURCES_PAGE_SIZE = 20;

export const DEFAULT_RETRIEVAL_LIMIT = 8;

/** Longest excerpt of a source's text returned to the client. */
export const CONTENT_PREVIEW_CHARS = 240;

export const TEXT_SOURCE_MAX_CHARS = 500_000;

/**
 * The journey a source takes, shown on the Test retrieval tab so users can see
 * what actually happens to their content.
 */
export const KNOWLEDGE_LIFECYCLE: ReadonlyArray<{ key: string; label: string; description: string }> = [
  { key: "source", label: "Source", description: "You add pasted text, a public URL or a text file." },
  { key: "ingestion", label: "Ingestion", description: "The content is fetched or read and decoded as UTF-8 text." },
  { key: "processing", label: "Processing", description: "Markup, scripts and stray whitespace are stripped." },
  {
    key: "chunking",
    label: "Chunking",
    description: `Text is split into ~${CHUNK_TARGET_TOKENS}-token passages with ~${CHUNK_OVERLAP_TOKENS} tokens of overlap on paragraph and sentence boundaries.`,
  },
  { key: "embedding", label: "Embedding", description: "Each passage is turned into a vector by the embedding provider." },
  { key: "indexing", label: "Indexing", description: "Passages are written to the searchable index with their counts." },
  { key: "retrieval", label: "Retrieval", description: "A question ranks passages and the best few are selected." },
  { key: "response", label: "AI response", description: "Those passages are given to the model, which answers and cites them." },
];
