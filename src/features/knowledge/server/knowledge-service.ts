import "server-only";

import { RECENT_SOURCES_LIMIT } from "@/features/knowledge/constants";
import { htmlToText } from "@/features/knowledge/html-text";
import type {
  CreateCollectionInput,
  CreateSourceInput,
  KnowledgeSearchInput,
  MoveSourceInput,
  updateCollectionSchema,
} from "@/features/knowledge/schemas";
import { processCollection, processSource, recomputeCollectionStatus } from "@/features/knowledge/server/pipeline";
import {
  countUnorganizedSources,
  deleteCollectionRow,
  deleteSourceRow,
  findCollectionById,
  findSourceById,
  insertCollection,
  insertKnowledgeSource,
  listCollectionOptions,
  listCollections,
  listKnowledgeSources,
  moveSourceToCollection,
  updateCollectionRow,
} from "@/features/knowledge/server/knowledge-repository";
import { retrieveKnowledge } from "@/features/knowledge/server/retrieval";
import {
  KNOWLEDGE_SCOPE_ALL,
  type Collection,
  type CollectionListFilters,
  type CollectionSummary,
  type KnowledgeOverview,
  type KnowledgeScope,
  type KnowledgeSource,
  type KnowledgeSourceListFilters,
  type KnowledgeSourceMetadata,
} from "@/features/knowledge/types";
import { validateUpload } from "@/features/knowledge/uploads";
import { ApiError } from "@/lib/api/api-error";
import { recordActivity } from "@/server/activity/activity-log";
import { withWorkspace } from "@/server/db/client";
import { recordUsage } from "@/server/usage/record-usage";
import type { RetrievedSource } from "@/types/ai";
import type { Paginated } from "@/types/pagination";
import type { z } from "zod";

export interface ActorContext {
  workspaceId: string;
  userId: string;
}

type UpdateInput = z.output<typeof updateCollectionSchema>;

/* -------------------------------------------------------------------------- */
/* Collections                                                                */
/* -------------------------------------------------------------------------- */

export function getCollections(
  workspaceId: string,
  filters: CollectionListFilters,
): Promise<Paginated<CollectionSummary>> {
  return listCollections(workspaceId, filters);
}

export async function getCollection(workspaceId: string, collectionId: string): Promise<Collection> {
  const collection = await findCollectionById(workspaceId, collectionId);
  if (!collection) throw ApiError.notFound("Collection not found");
  return collection;
}

export async function createCollection(ctx: ActorContext, input: CreateCollectionInput): Promise<Collection> {
  return withWorkspace(ctx.workspaceId, async (client) => {
    const collection = await insertCollection(
      {
        workspaceId: ctx.workspaceId,
        createdBy: ctx.userId,
        name: input.name,
        description: input.description?.trim() ? input.description.trim() : null,
      },
      client,
    );
    await recordActivity(
      {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        entityType: "knowledge_collection",
        entityId: collection.id,
        action: "created",
        summary: `Created collection “${collection.name}”`,
      },
      client,
    );
    return collection;
  });
}

export async function updateCollection(
  ctx: ActorContext,
  collectionId: string,
  input: UpdateInput,
): Promise<Collection> {
  return withWorkspace(ctx.workspaceId, async (client) => {
    const existing = await findCollectionById(ctx.workspaceId, collectionId, client);
    if (!existing) throw ApiError.notFound("Collection not found");

    await updateCollectionRow(
      ctx.workspaceId,
      collectionId,
      {
        name: input.name,
        description:
          input.description === undefined ? undefined : input.description?.trim() ? input.description.trim() : null,
      },
      client,
    );

    const updated = await findCollectionById(ctx.workspaceId, collectionId, client);
    if (!updated) throw ApiError.notFound("Collection not found");

    await recordActivity(
      {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        entityType: "knowledge_collection",
        entityId: collectionId,
        action: "updated",
        summary: `Updated collection “${updated.name}”`,
        metadata: { fields: Object.keys(input) },
      },
      client,
    );
    return updated;
  });
}

/**
 * Deleting a collection destroys the grouping, not the documents: the foreign
 * keys are ON DELETE SET NULL, so its sources and their indexed passages move
 * to Unorganized intact. Any chatbot or agent attached to it loses that
 * grounding, which is why the attachment counts are surfaced before the fact.
 */
export async function deleteCollection(ctx: ActorContext, collectionId: string): Promise<void> {
  const existing = await findCollectionById(ctx.workspaceId, collectionId);
  if (!existing) throw ApiError.notFound("Collection not found");

  await deleteCollectionRow(ctx.workspaceId, collectionId);
  await recordActivity({
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    entityType: "knowledge_collection",
    entityId: collectionId,
    action: "deleted",
    summary: `Deleted collection “${existing.name}”`,
    metadata: {
      unfiledSourceCount: existing.sourceCount,
      detachedChatbotCount: existing.attachedChatbotCount,
      detachedAgentCount: existing.attachedAgentCount,
    },
  });
}

export async function reprocessCollection(ctx: ActorContext, collectionId: string): Promise<Collection> {
  const existing = await getCollection(ctx.workspaceId, collectionId);
  const collection = await processCollection({ workspaceId: ctx.workspaceId, collectionId });
  await recordActivity({
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    entityType: "knowledge_collection",
    entityId: collectionId,
    action: "reprocessed",
    summary: `Reprocessed ${existing.sourceCount} source${existing.sourceCount === 1 ? "" : "s"} in “${existing.name}”`,
  });
  return collection;
}

/* -------------------------------------------------------------------------- */
/* Knowledge overview                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Everything the Knowledge landing page shows, in one round trip: the
 * collections, the most recently added documents across all of them, and how
 * many are still waiting to be filed.
 */
export async function getKnowledgeOverview(
  workspaceId: string,
  collectionLimit: number,
): Promise<KnowledgeOverview> {
  const [collections, recent, unorganizedCount] = await Promise.all([
    listCollections(workspaceId, { page: 1, pageSize: collectionLimit }),
    listKnowledgeSources(workspaceId, KNOWLEDGE_SCOPE_ALL, { page: 1, pageSize: RECENT_SOURCES_LIMIT }),
    countUnorganizedSources(workspaceId),
  ]);

  return {
    collections: collections.items,
    collectionTotal: collections.total,
    recentSources: recent.items,
    unorganizedCount,
    totalSourceCount: recent.total,
  };
}

/** Collections a document can be filed into, for the move menu. */
export function getCollectionOptions(workspaceId: string): Promise<Array<{ id: string; name: string }>> {
  return listCollectionOptions(workspaceId);
}

/* -------------------------------------------------------------------------- */
/* Sources                                                                    */
/* -------------------------------------------------------------------------- */

export async function getKnowledgeSources(
  workspaceId: string,
  scope: KnowledgeScope,
  filters: KnowledgeSourceListFilters,
): Promise<Paginated<KnowledgeSource>> {
  // A collection scope has to be proved to exist in this workspace, or a
  // listing for someone else's collection id would return an empty page
  // instead of a 404 and read as "this collection is empty".
  if (scope.kind === "collection") await getCollection(workspaceId, scope.collectionId);
  return listKnowledgeSources(workspaceId, scope, filters);
}

async function afterSourceAdded(ctx: ActorContext, source: KnowledgeSource): Promise<KnowledgeSource> {
  await recordActivity({
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    entityType: "knowledge_source",
    entityId: source.id,
    action: "created",
    summary: source.collectionName
      ? `Added ${source.type} source “${source.name}” to “${source.collectionName}”`
      : `Added ${source.type} source “${source.name}” to Unorganized`,
    metadata: { collectionId: source.collectionId },
  });
  // Inline processing: the caller waits, and the response already carries the
  // final status so the table does not flicker through a stale row.
  return processSource({ workspaceId: ctx.workspaceId, sourceId: source.id });
}

/**
 * Resolves the collection a new document is being added to. `null` is a valid
 * answer meaning Unorganized; an id that is not this workspace's is a 404.
 */
async function resolveTargetCollection(workspaceId: string, collectionId: string | null): Promise<string | null> {
  if (!collectionId) return null;
  await getCollection(workspaceId, collectionId);
  return collectionId;
}

export async function createKnowledgeSource(
  ctx: ActorContext,
  collectionId: string | null,
  input: CreateSourceInput,
): Promise<KnowledgeSource> {
  const target = await resolveTargetCollection(ctx.workspaceId, collectionId);

  const source = await withWorkspace(ctx.workspaceId, (client) =>
    input.type === "text"
      ? insertKnowledgeSource(
          {
            workspaceId: ctx.workspaceId,
            collectionId: target,
            type: "text",
            name: input.name,
            uri: null,
            content: input.content,
            metadata: { contentType: "text/plain", sizeBytes: Buffer.byteLength(input.content, "utf8") },
          },
          client,
        )
      : insertKnowledgeSource(
          {
            workspaceId: ctx.workspaceId,
            collectionId: target,
            type: "url",
            // The URL stands in as the name until ingestion finds a page title.
            name: input.name?.trim() ? input.name.trim() : input.url,
            uri: input.url,
            content: null,
            metadata: {},
          },
          client,
        ),
  );

  return afterSourceAdded(ctx, source);
}

export interface UploadedFile {
  name: string;
  type: string;
  size: number;
  bytes: ArrayBuffer;
}

/**
 * Creates a source from a multipart upload. The declared extension, the
 * declared content type and the decoded bytes are all checked: only the bytes
 * are actually trustworthy, so they decide.
 */
export async function createUploadedKnowledgeSource(
  ctx: ActorContext,
  collectionId: string | null,
  file: UploadedFile,
): Promise<KnowledgeSource> {
  const target = await resolveTargetCollection(ctx.workspaceId, collectionId);

  const validation = validateUpload({ name: file.name, type: file.type, size: file.size });
  if (!validation.ok) throw ApiError.validation({ file: [validation.message] }, validation.message);

  // `fatal` makes an invalid byte sequence an error rather than a run of
  // replacement characters, which is the only reliable binary check.
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
  } catch {
    const message = "That file is not valid UTF-8 text. Save it as UTF-8 and upload it again.";
    throw ApiError.validation({ file: [message] }, message);
  }

  const content = validation.extension === ".html" ? htmlToText(decoded) : decoded;
  if (!content.trim()) {
    const message = "That file contains no readable text.";
    throw ApiError.validation({ file: [message] }, message);
  }

  const metadata: KnowledgeSourceMetadata = {
    fileName: file.name,
    contentType: file.type || "text/plain",
    sizeBytes: file.size,
  };

  const source = await withWorkspace(ctx.workspaceId, (client) =>
    insertKnowledgeSource(
      {
        workspaceId: ctx.workspaceId,
        collectionId: target,
        type: "file",
        name: file.name.slice(0, 160),
        uri: null,
        content,
        metadata,
      },
      client,
    ),
  );

  return afterSourceAdded(ctx, source);
}

export async function getKnowledgeSource(workspaceId: string, sourceId: string): Promise<KnowledgeSource> {
  const source = await findSourceById(workspaceId, sourceId);
  if (!source) throw ApiError.notFound("Source not found");
  return source;
}

/**
 * Files a document into a collection, or back into Unorganized.
 *
 * Both the collection it left and the one it joined have to have their rollup
 * status recomputed: a move can empty one collection and put the other into
 * `error` if the document had failed to process.
 */
export async function moveKnowledgeSource(
  ctx: ActorContext,
  sourceId: string,
  input: MoveSourceInput,
): Promise<KnowledgeSource> {
  const source = await getKnowledgeSource(ctx.workspaceId, sourceId);
  const target = await resolveTargetCollection(ctx.workspaceId, input.collectionId);
  if (source.collectionId === target) return source;

  await moveSourceToCollection(ctx.workspaceId, sourceId, target);
  await Promise.all([
    recomputeCollectionStatus(ctx.workspaceId, source.collectionId),
    recomputeCollectionStatus(ctx.workspaceId, target),
  ]);

  const updated = await getKnowledgeSource(ctx.workspaceId, sourceId);
  await recordActivity({
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    entityType: "knowledge_source",
    entityId: sourceId,
    action: "moved",
    summary: updated.collectionName
      ? `Filed “${updated.name}” into “${updated.collectionName}”`
      : `Moved “${updated.name}” to Unorganized`,
    metadata: { from: source.collectionId, to: target },
  });
  return updated;
}

export async function reprocessKnowledgeSource(ctx: ActorContext, sourceId: string): Promise<KnowledgeSource> {
  await getKnowledgeSource(ctx.workspaceId, sourceId);

  const updated = await processSource({ workspaceId: ctx.workspaceId, sourceId });
  await recordActivity({
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    entityType: "knowledge_source",
    entityId: sourceId,
    action: "reprocessed",
    summary: `Reprocessed source “${updated.name}”`,
    metadata: { collectionId: updated.collectionId, status: updated.status },
  });
  return updated;
}

export async function deleteKnowledgeSource(ctx: ActorContext, sourceId: string): Promise<void> {
  const source = await getKnowledgeSource(ctx.workspaceId, sourceId);

  // Chunks cascade with the source row (migration 0008).
  await deleteSourceRow(ctx.workspaceId, sourceId);
  await recomputeCollectionStatus(ctx.workspaceId, source.collectionId);
  await recordActivity({
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    entityType: "knowledge_source",
    entityId: sourceId,
    action: "deleted",
    summary: `Removed source “${source.name}”`,
    metadata: { collectionId: source.collectionId, chunkCount: source.chunkCount },
  });
}

/* -------------------------------------------------------------------------- */
/* Retrieval                                                                  */
/* -------------------------------------------------------------------------- */

export interface KnowledgeSearchResult {
  query: string;
  results: RetrievedSource[];
}

/**
 * The Test retrieval tab. Runs exactly the retrieval the chat pipeline runs, so
 * what users see here is what the model will be given — including the fact that
 * unorganized documents are out of scope.
 */
export async function searchCollection(
  ctx: ActorContext,
  collectionId: string,
  input: KnowledgeSearchInput,
): Promise<KnowledgeSearchResult> {
  await getCollection(ctx.workspaceId, collectionId);
  const results = await retrieveKnowledge(ctx.workspaceId, [collectionId], input.query, input.limit);
  await recordUsage({
    workspaceId: ctx.workspaceId,
    kind: "retrieval",
    quantity: 1,
    refType: "knowledge_collection",
    refId: collectionId,
  });
  return { query: input.query, results };
}
