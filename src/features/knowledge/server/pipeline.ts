import "server-only";

import { chunkText, estimateTokens, normalizeSourceText } from "@/features/knowledge/chunking";
import type { KnowledgeEmbeddingConfig } from "@/features/knowledge/types";
import { EMBEDDING_BATCH_SIZE, getEmbeddingProvider } from "@/features/knowledge/server/embeddings";
import {
  countSourceStatuses,
  findKnowledgeBaseById,
  findSourceById,
  getSourceContent,
  listSourceIds,
  markSourcesPending,
  replaceSourceChunks,
  setChunkEmbeddings,
  setKnowledgeBaseStatus,
  setSourceContent,
  setSourceCounts,
  setSourceStatus,
  type ChunkEmbedding,
} from "@/features/knowledge/server/knowledge-repository";
import { fetchUrlDocument } from "@/features/knowledge/server/url-ingest";
import type { KnowledgeBase, KnowledgeBaseStatus, KnowledgeSource, KnowledgeSourceStatus } from "@/features/knowledge/types";
import { ApiError, isApiError } from "@/lib/api/api-error";
import type { EmbeddingProvider } from "@/server/ai/gateway";
import { withWorkspace } from "@/server/db/client";
import { recordUsage } from "@/server/usage/record-usage";

/**
 * The ingestion pipeline.
 *
 * A source moves through ingesting → processing → chunking → embedding →
 * indexing → ready, and the status is committed before each stage begins.
 * That is deliberate: the stages are slow (a network fetch, an embedding call),
 * so the UI polls the source row to show where the work actually is. Only the
 * chunk replacement runs in a transaction, because chunks are derived data that
 * must never be observed half-written.
 *
 * Execution is inline in the request that triggers it. See the module note at
 * the bottom for what moving to a queue changes.
 */

const MAX_ERROR_LENGTH = 500;

/** Anything unexpected becomes a message a non-technical user can act on. */
function toUserMessage(error: unknown): string {
  if (isApiError(error)) return error.message.slice(0, MAX_ERROR_LENGTH);
  if (error instanceof Error && error.message) {
    return `Processing failed: ${error.message.slice(0, MAX_ERROR_LENGTH - 20)}`;
  }
  return "Processing failed for an unknown reason. Try again, and contact support if it keeps happening.";
}

function resolveStatus(counts: { total: number; failed: number; inFlight: number }): KnowledgeBaseStatus {
  if (counts.total === 0) return "empty";
  if (counts.inFlight > 0) return "processing";
  if (counts.failed > 0) return "error";
  return "ready";
}

/**
 * Recomputes the parent knowledge base status from its sources. Derived rather
 * than tracked so it is correct no matter which source finished last.
 */
export async function recomputeKnowledgeBaseStatus(workspaceId: string, knowledgeBaseId: string): Promise<KnowledgeBaseStatus> {
  const counts = await countSourceStatuses(workspaceId, knowledgeBaseId);
  const status = resolveStatus(counts);
  await setKnowledgeBaseStatus(workspaceId, knowledgeBaseId, status);
  return status;
}

export interface ProcessSourceOptions {
  /** Injection point for a real provider; defaults to the configured one. */
  embeddings?: EmbeddingProvider;
}

interface StageContext {
  workspaceId: string;
  sourceId: string;
}

async function advance(ctx: StageContext, status: KnowledgeSourceStatus): Promise<void> {
  await setSourceStatus(ctx.workspaceId, ctx.sourceId, status, { error: null });
}

/** Stage 1: get the raw text into the source row. */
async function ingest(ctx: StageContext, source: KnowledgeSource): Promise<string> {
  await advance(ctx, "ingesting");

  if (source.type === "url") {
    if (!source.uri) throw ApiError.badRequest("This source has no URL to import.");
    const document = await fetchUrlDocument(source.uri);
    await setSourceContent(
      ctx.workspaceId,
      ctx.sourceId,
      document.text,
      { contentType: document.contentType, sizeBytes: document.byteLength, finalUrl: document.finalUrl },
      // A URL source keeps whatever name the user typed; the page title is only
      // used when they left it empty (the placeholder name is the URL itself).
      source.name === source.uri && document.title ? { name: document.title.slice(0, 160) } : {},
    );
    return document.text;
  }

  // Text and file sources are stored complete at creation time; re-reading the
  // row keeps reprocessing idempotent.
  const content = await getSourceContent(ctx.workspaceId, ctx.sourceId);
  if (!content) throw ApiError.badRequest("This source has no stored content to process.");
  return content;
}

/** Stages 4 and 5: chunk, then embed each chunk. */
async function chunkAndEmbed(
  ctx: StageContext,
  knowledgeBaseId: string,
  text: string,
  config: KnowledgeEmbeddingConfig,
  provider: EmbeddingProvider,
): Promise<{ chunkCount: number; embeddedTokens: number }> {
  await advance(ctx, "chunking");
  const chunks = chunkText(text, {
    targetTokens: config.chunkTargetTokens,
    overlapTokens: config.chunkOverlapTokens,
  });
  if (chunks.length === 0) {
    throw ApiError.badRequest("No readable text could be extracted from this source.");
  }

  const chunkIds = await withWorkspace(ctx.workspaceId, (client) =>
    replaceSourceChunks(ctx.workspaceId, knowledgeBaseId, ctx.sourceId, chunks, client),
  );

  await advance(ctx, "embedding");
  let embeddedTokens = 0;
  for (let offset = 0; offset < chunks.length; offset += EMBEDDING_BATCH_SIZE) {
    const batch = chunks.slice(offset, offset + EMBEDDING_BATCH_SIZE);
    const vectors = await provider.embed(batch.map((chunk) => chunk.content));
    const entries: ChunkEmbedding[] = [];
    for (let index = 0; index < batch.length; index++) {
      const chunk = batch[index];
      const vector = vectors[index];
      const chunkId = chunkIds[offset + index];
      if (!chunk || !vector || !chunkId) continue;
      entries.push({ chunkId, embedding: vector });
      embeddedTokens += chunk.tokenCount;
    }
    await setChunkEmbeddings(ctx.workspaceId, entries);
  }

  return { chunkCount: chunks.length, embeddedTokens };
}

/**
 * Runs one source through the whole pipeline and returns its final row. Never
 * throws for content problems: a failure is recorded on the source as a
 * readable error so the UI can show it and offer a retry.
 */
export async function processSource(
  ctx: { workspaceId: string; sourceId: string },
  options: ProcessSourceOptions = {},
): Promise<KnowledgeSource> {
  const source = await findSourceById(ctx.workspaceId, ctx.sourceId);
  if (!source) throw ApiError.notFound("Source not found");

  const base = await findKnowledgeBaseById(ctx.workspaceId, source.knowledgeBaseId);
  if (!base) throw ApiError.notFound("Knowledge base not found");

  const provider = options.embeddings ?? getEmbeddingProvider();
  const stage: StageContext = { workspaceId: ctx.workspaceId, sourceId: ctx.sourceId };

  try {
    const raw = await ingest(stage, source);

    await advance(stage, "processing");
    const text = normalizeSourceText(raw);
    if (!text) throw ApiError.badRequest("This source contains no readable text.");

    const { chunkCount, embeddedTokens } = await chunkAndEmbed(stage, source.knowledgeBaseId, text, base.embeddingConfig, provider);

    await advance(stage, "indexing");
    // The source's token count describes its own content; the embedding usage
    // event below counts chunk tokens, which include the overlap that was
    // actually sent to the provider.
    await setSourceCounts(ctx.workspaceId, ctx.sourceId, { chunkCount, tokenCount: estimateTokens(text) });
    if (embeddedTokens > 0) {
      await recordUsage({
        workspaceId: ctx.workspaceId,
        kind: "embedding",
        quantity: embeddedTokens,
        refType: "knowledge_source",
        refId: ctx.sourceId,
      });
    }

    await advance(stage, "ready");
  } catch (error) {
    await setSourceStatus(ctx.workspaceId, ctx.sourceId, "failed", { error: toUserMessage(error) });
    // Chunks from a previous successful run are intentionally left in place:
    // stale answers beat no answers, and the next successful run replaces them.
    console.error("[knowledge] source processing failed", { sourceId: ctx.sourceId, error });
  }

  await recomputeKnowledgeBaseStatus(ctx.workspaceId, source.knowledgeBaseId);

  const updated = await findSourceById(ctx.workspaceId, ctx.sourceId);
  if (!updated) throw ApiError.notFound("Source not found");
  return updated;
}

/**
 * Reprocesses every source in a knowledge base. All sources are marked pending
 * up front so the UI reflects the queue even if the request is cut short, then
 * they run one at a time to keep provider load predictable.
 */
export async function processKnowledgeBase(
  ctx: { workspaceId: string; knowledgeBaseId: string },
  options: ProcessSourceOptions = {},
): Promise<KnowledgeBase> {
  const sourceIds = await listSourceIds(ctx.workspaceId, ctx.knowledgeBaseId);
  if (sourceIds.length > 0) {
    await markSourcesPending(ctx.workspaceId, ctx.knowledgeBaseId);
    await setKnowledgeBaseStatus(ctx.workspaceId, ctx.knowledgeBaseId, "processing");
    for (const sourceId of sourceIds) {
      await processSource({ workspaceId: ctx.workspaceId, sourceId }, options);
    }
  }
  await recomputeKnowledgeBaseStatus(ctx.workspaceId, ctx.knowledgeBaseId);

  const base = await findKnowledgeBaseById(ctx.workspaceId, ctx.knowledgeBaseId);
  if (!base) throw ApiError.notFound("Knowledge base not found");
  return base;
}

/*
 * Background execution
 * --------------------
 * Processing runs inline in the request today, which is why the routes are
 * write-scoped and why per-stage statuses are committed as they happen. The
 * seam for moving to a queue is exactly `processSource` / `processKnowledgeBase`:
 * a worker would consume source ids, and the route handlers would leave the
 * source in `pending` and return immediately. The UI already polls while any
 * source is in flight, so it needs no change.
 */
