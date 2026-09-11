import "server-only";

import { DEFAULT_EMBEDDING_CONFIG } from "@/features/knowledge/constants";
import { htmlToText } from "@/features/knowledge/html-text";
import type { CreateKnowledgeBaseInput, CreateSourceInput, KnowledgeSearchInput, updateKnowledgeBaseSchema } from "@/features/knowledge/schemas";
import { processKnowledgeBase, processSource, recomputeKnowledgeBaseStatus } from "@/features/knowledge/server/pipeline";
import {
  deleteKnowledgeBaseRow,
  deleteSourceRow,
  findKnowledgeBaseById,
  findSourceById,
  insertKnowledgeBase,
  insertKnowledgeSource,
  listKnowledgeBases,
  listKnowledgeSources,
  updateKnowledgeBaseRow,
} from "@/features/knowledge/server/knowledge-repository";
import { retrieveKnowledge } from "@/features/knowledge/server/retrieval";
import type {
  KnowledgeBase,
  KnowledgeBaseListFilters,
  KnowledgeBaseSummary,
  KnowledgeSource,
  KnowledgeSourceListFilters,
  KnowledgeSourceMetadata,
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

type UpdateInput = z.output<typeof updateKnowledgeBaseSchema>;

/* -------------------------------------------------------------------------- */
/* Knowledge bases                                                            */
/* -------------------------------------------------------------------------- */

export function getKnowledgeBases(
  workspaceId: string,
  filters: KnowledgeBaseListFilters,
): Promise<Paginated<KnowledgeBaseSummary>> {
  return listKnowledgeBases(workspaceId, filters);
}

export async function getKnowledgeBase(workspaceId: string, knowledgeBaseId: string): Promise<KnowledgeBase> {
  const base = await findKnowledgeBaseById(workspaceId, knowledgeBaseId);
  if (!base) throw ApiError.notFound("Knowledge base not found");
  return base;
}

export async function createKnowledgeBase(ctx: ActorContext, input: CreateKnowledgeBaseInput): Promise<KnowledgeBase> {
  return withWorkspace(ctx.workspaceId, async (client) => {
    const base = await insertKnowledgeBase(
      {
        workspaceId: ctx.workspaceId,
        createdBy: ctx.userId,
        name: input.name,
        description: input.description?.trim() ? input.description.trim() : null,
        embeddingConfig: DEFAULT_EMBEDDING_CONFIG,
      },
      client,
    );
    await recordActivity(
      {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        entityType: "knowledge_base",
        entityId: base.id,
        action: "created",
        summary: `Created knowledge base “${base.name}”`,
      },
      client,
    );
    return base;
  });
}

export async function updateKnowledgeBase(
  ctx: ActorContext,
  knowledgeBaseId: string,
  input: UpdateInput,
): Promise<KnowledgeBase> {
  return withWorkspace(ctx.workspaceId, async (client) => {
    const existing = await findKnowledgeBaseById(ctx.workspaceId, knowledgeBaseId, client);
    if (!existing) throw ApiError.notFound("Knowledge base not found");

    await updateKnowledgeBaseRow(
      ctx.workspaceId,
      knowledgeBaseId,
      {
        name: input.name,
        description:
          input.description === undefined ? undefined : input.description?.trim() ? input.description.trim() : null,
      },
      client,
    );

    const updated = await findKnowledgeBaseById(ctx.workspaceId, knowledgeBaseId, client);
    if (!updated) throw ApiError.notFound("Knowledge base not found");

    await recordActivity(
      {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        entityType: "knowledge_base",
        entityId: knowledgeBaseId,
        action: "updated",
        summary: `Updated knowledge base “${updated.name}”`,
        metadata: { fields: Object.keys(input) },
      },
      client,
    );
    return updated;
  });
}

export async function deleteKnowledgeBase(ctx: ActorContext, knowledgeBaseId: string): Promise<void> {
  const existing = await findKnowledgeBaseById(ctx.workspaceId, knowledgeBaseId);
  if (!existing) throw ApiError.notFound("Knowledge base not found");

  // Sources, chunks and the chatbot/agent attachments cascade in the database
  // (migrations 0001 and 0008), so one delete is enough.
  await deleteKnowledgeBaseRow(ctx.workspaceId, knowledgeBaseId);
  await recordActivity({
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    entityType: "knowledge_base",
    entityId: knowledgeBaseId,
    action: "deleted",
    summary: `Deleted knowledge base “${existing.name}”`,
    metadata: { sourceCount: existing.sourceCount, chunkCount: existing.chunkCount },
  });
}

export async function reprocessKnowledgeBase(ctx: ActorContext, knowledgeBaseId: string): Promise<KnowledgeBase> {
  const existing = await getKnowledgeBase(ctx.workspaceId, knowledgeBaseId);
  const base = await processKnowledgeBase({ workspaceId: ctx.workspaceId, knowledgeBaseId });
  await recordActivity({
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    entityType: "knowledge_base",
    entityId: knowledgeBaseId,
    action: "reprocessed",
    summary: `Reprocessed ${existing.sourceCount} source${existing.sourceCount === 1 ? "" : "s"} in “${existing.name}”`,
  });
  return base;
}

/* -------------------------------------------------------------------------- */
/* Sources                                                                    */
/* -------------------------------------------------------------------------- */

export async function getKnowledgeSources(
  workspaceId: string,
  knowledgeBaseId: string,
  filters: KnowledgeSourceListFilters,
): Promise<Paginated<KnowledgeSource>> {
  await getKnowledgeBase(workspaceId, knowledgeBaseId);
  return listKnowledgeSources(workspaceId, knowledgeBaseId, filters);
}

async function afterSourceAdded(ctx: ActorContext, base: KnowledgeBase, source: KnowledgeSource): Promise<KnowledgeSource> {
  await recordActivity({
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    entityType: "knowledge_source",
    entityId: source.id,
    action: "created",
    summary: `Added ${source.type} source “${source.name}” to “${base.name}”`,
    metadata: { knowledgeBaseId: base.id },
  });
  // Inline processing: the caller waits, and the response already carries the
  // final status so the table does not flicker through a stale row.
  return processSource({ workspaceId: ctx.workspaceId, sourceId: source.id });
}

export async function createKnowledgeSource(
  ctx: ActorContext,
  knowledgeBaseId: string,
  input: CreateSourceInput,
): Promise<KnowledgeSource> {
  const base = await getKnowledgeBase(ctx.workspaceId, knowledgeBaseId);

  const source = await withWorkspace(ctx.workspaceId, (client) =>
    input.type === "text"
      ? insertKnowledgeSource(
          {
            workspaceId: ctx.workspaceId,
            knowledgeBaseId,
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
            knowledgeBaseId,
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

  return afterSourceAdded(ctx, base, source);
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
  knowledgeBaseId: string,
  file: UploadedFile,
): Promise<KnowledgeSource> {
  const base = await getKnowledgeBase(ctx.workspaceId, knowledgeBaseId);

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
        knowledgeBaseId,
        type: "file",
        name: file.name.slice(0, 160),
        uri: null,
        content,
        metadata,
      },
      client,
    ),
  );

  return afterSourceAdded(ctx, base, source);
}

async function getSource(workspaceId: string, sourceId: string): Promise<KnowledgeSource> {
  const source = await findSourceById(workspaceId, sourceId);
  if (!source) throw ApiError.notFound("Source not found");
  return source;
}

export async function reprocessKnowledgeSource(
  ctx: ActorContext,
  knowledgeBaseId: string,
  sourceId: string,
): Promise<KnowledgeSource> {
  const source = await getSource(ctx.workspaceId, sourceId);
  // The id from the URL is never trusted for tenancy or for parentage.
  if (source.knowledgeBaseId !== knowledgeBaseId) throw ApiError.notFound("Source not found");

  const updated = await processSource({ workspaceId: ctx.workspaceId, sourceId });
  await recordActivity({
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    entityType: "knowledge_source",
    entityId: sourceId,
    action: "reprocessed",
    summary: `Reprocessed source “${updated.name}”`,
    metadata: { knowledgeBaseId, status: updated.status },
  });
  return updated;
}

export async function deleteKnowledgeSource(
  ctx: ActorContext,
  knowledgeBaseId: string,
  sourceId: string,
): Promise<void> {
  const source = await getSource(ctx.workspaceId, sourceId);
  if (source.knowledgeBaseId !== knowledgeBaseId) throw ApiError.notFound("Source not found");

  // Chunks cascade with the source row (migration 0008).
  await deleteSourceRow(ctx.workspaceId, sourceId);
  await recomputeKnowledgeBaseStatus(ctx.workspaceId, knowledgeBaseId);
  await recordActivity({
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    entityType: "knowledge_source",
    entityId: sourceId,
    action: "deleted",
    summary: `Removed source “${source.name}”`,
    metadata: { knowledgeBaseId, chunkCount: source.chunkCount },
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
 * what users see here is what the model will be given.
 */
export async function searchKnowledgeBase(
  ctx: ActorContext,
  knowledgeBaseId: string,
  input: KnowledgeSearchInput,
): Promise<KnowledgeSearchResult> {
  await getKnowledgeBase(ctx.workspaceId, knowledgeBaseId);
  const results = await retrieveKnowledge(ctx.workspaceId, [knowledgeBaseId], input.query, input.limit);
  await recordUsage({
    workspaceId: ctx.workspaceId,
    kind: "retrieval",
    quantity: 1,
    refType: "knowledge_base",
    refId: knowledgeBaseId,
  });
  return { query: input.query, results };
}
