import "server-only";

import { CONTENT_PREVIEW_CHARS, DEFAULT_EMBEDDING_CONFIG } from "@/features/knowledge/constants";
import type {
  KnowledgeBase,
  KnowledgeBaseListFilters,
  KnowledgeBaseStatus,
  KnowledgeBaseSummary,
  KnowledgeEmbeddingConfig,
  KnowledgeSource,
  KnowledgeSourceListFilters,
  KnowledgeSourceMetadata,
  KnowledgeSourceStatus,
  KnowledgeSourceType,
} from "@/features/knowledge/types";
import { query, queryOne, type Queryable } from "@/server/db/client";
import { likePattern, normalizePage, ParamBuilder, toIsoRequired, toPaginated } from "@/server/db/sql";
import type { Paginated } from "@/types/pagination";

/* -------------------------------------------------------------------------- */
/* Knowledge bases                                                            */
/* -------------------------------------------------------------------------- */

interface KnowledgeBaseRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  status: KnowledgeBaseStatus;
  embedding_config: Partial<KnowledgeEmbeddingConfig> | null;
  created_at: Date;
  updated_at: Date;
  source_count: string | number;
  ready_source_count: string | number;
  failed_source_count: string | number;
  chunk_count: string | number;
  token_count: string | number;
  attached_chatbot_count: string | number;
  attached_agent_count: string | number;
}

/**
 * Counts come from correlated subqueries rather than a denormalized column so
 * they can never drift from the rows they describe.
 */
const SELECT_KNOWLEDGE_BASE = `
  SELECT kb.id, kb.workspace_id, kb.name, kb.description, kb.status, kb.embedding_config, kb.created_at, kb.updated_at,
         (SELECT count(*) FROM knowledge_sources ks WHERE ks.knowledge_base_id = kb.id) AS source_count,
         (SELECT count(*) FROM knowledge_sources ks WHERE ks.knowledge_base_id = kb.id AND ks.status = 'ready') AS ready_source_count,
         (SELECT count(*) FROM knowledge_sources ks WHERE ks.knowledge_base_id = kb.id AND ks.status = 'failed') AS failed_source_count,
         (SELECT coalesce(sum(ks.chunk_count), 0) FROM knowledge_sources ks WHERE ks.knowledge_base_id = kb.id) AS chunk_count,
         (SELECT coalesce(sum(ks.token_count), 0) FROM knowledge_sources ks WHERE ks.knowledge_base_id = kb.id) AS token_count,
         (SELECT count(*) FROM chatbot_knowledge_bases ckb WHERE ckb.knowledge_base_id = kb.id) AS attached_chatbot_count,
         (SELECT count(*) FROM agent_knowledge_bases akb WHERE akb.knowledge_base_id = kb.id) AS attached_agent_count
  FROM knowledge_bases kb
`;

function mapKnowledgeBase(row: KnowledgeBaseRow): KnowledgeBase {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    status: row.status,
    embeddingConfig: { ...DEFAULT_EMBEDDING_CONFIG, ...(row.embedding_config ?? {}) },
    sourceCount: Number(row.source_count ?? 0),
    readySourceCount: Number(row.ready_source_count ?? 0),
    failedSourceCount: Number(row.failed_source_count ?? 0),
    chunkCount: Number(row.chunk_count ?? 0),
    tokenCount: Number(row.token_count ?? 0),
    attachedChatbotCount: Number(row.attached_chatbot_count ?? 0),
    attachedAgentCount: Number(row.attached_agent_count ?? 0),
    createdAt: toIsoRequired(row.created_at),
    updatedAt: toIsoRequired(row.updated_at),
  };
}

function toSummary(base: KnowledgeBase): KnowledgeBaseSummary {
  return {
    id: base.id,
    name: base.name,
    description: base.description,
    status: base.status,
    sourceCount: base.sourceCount,
    readySourceCount: base.readySourceCount,
    failedSourceCount: base.failedSourceCount,
    chunkCount: base.chunkCount,
    tokenCount: base.tokenCount,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
  };
}

export async function listKnowledgeBases(
  workspaceId: string,
  filters: KnowledgeBaseListFilters,
): Promise<Paginated<KnowledgeBaseSummary>> {
  const page = normalizePage(filters);
  const params = new ParamBuilder();
  const where: string[] = [`kb.workspace_id = ${params.add(workspaceId)}`];
  if (filters.status) where.push(`kb.status = ${params.add(filters.status)}`);
  if (filters.q) {
    const pattern = params.add(likePattern(filters.q));
    where.push(`(kb.name ILIKE ${pattern} OR kb.description ILIKE ${pattern})`);
  }
  const whereSql = where.join(" AND ");

  const [rows, countRow] = await Promise.all([
    query<KnowledgeBaseRow>(
      `${SELECT_KNOWLEDGE_BASE} WHERE ${whereSql} ORDER BY kb.updated_at DESC LIMIT ${params.add(page.pageSize)} OFFSET ${params.add(page.offset)}`,
      params.values,
    ),
    queryOne<{ count: string }>(
      `SELECT count(*) AS count FROM knowledge_bases kb WHERE ${whereSql}`,
      params.values.slice(0, -2),
    ),
  ]);

  return toPaginated(rows.map(mapKnowledgeBase).map(toSummary), Number(countRow?.count ?? 0), page);
}

export async function findKnowledgeBaseById(
  workspaceId: string,
  knowledgeBaseId: string,
  client?: Queryable,
): Promise<KnowledgeBase | null> {
  const row = await queryOne<KnowledgeBaseRow>(
    `${SELECT_KNOWLEDGE_BASE} WHERE kb.workspace_id = $1 AND kb.id = $2`,
    [workspaceId, knowledgeBaseId],
    client,
  );
  return row ? mapKnowledgeBase(row) : null;
}

export interface InsertKnowledgeBaseInput {
  workspaceId: string;
  createdBy: string;
  name: string;
  description: string | null;
  embeddingConfig: KnowledgeEmbeddingConfig;
}

export async function insertKnowledgeBase(input: InsertKnowledgeBaseInput, client?: Queryable): Promise<KnowledgeBase> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO knowledge_bases (workspace_id, created_by, name, description, embedding_config)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [input.workspaceId, input.createdBy, input.name, input.description, input.embeddingConfig],
    client,
  );
  if (!row) throw new Error("Failed to insert knowledge base");
  const base = await findKnowledgeBaseById(input.workspaceId, row.id, client);
  if (!base) throw new Error("Knowledge base vanished after insert");
  return base;
}

export interface KnowledgeBasePatch {
  name?: string;
  description?: string | null;
}

export async function updateKnowledgeBaseRow(
  workspaceId: string,
  knowledgeBaseId: string,
  patch: KnowledgeBasePatch,
  client?: Queryable,
): Promise<void> {
  const params = new ParamBuilder();
  const sets: string[] = [];
  if (patch.name !== undefined) sets.push(`name = ${params.add(patch.name)}`);
  if (patch.description !== undefined) sets.push(`description = ${params.add(patch.description)}`);
  if (sets.length === 0) return;
  await query(
    `UPDATE knowledge_bases SET ${sets.join(", ")} WHERE workspace_id = ${params.add(workspaceId)} AND id = ${params.add(knowledgeBaseId)}`,
    params.values,
    client,
  );
}

export async function deleteKnowledgeBaseRow(workspaceId: string, knowledgeBaseId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    "DELETE FROM knowledge_bases WHERE workspace_id = $1 AND id = $2 RETURNING id",
    [workspaceId, knowledgeBaseId],
  );
  return rows.length > 0;
}

export interface SourceStatusCounts {
  total: number;
  ready: number;
  failed: number;
  inFlight: number;
}

export async function countSourceStatuses(
  workspaceId: string,
  knowledgeBaseId: string,
  client?: Queryable,
): Promise<SourceStatusCounts> {
  const row = await queryOne<{ total: string; ready: string; failed: string; in_flight: string }>(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE status = 'ready') AS ready,
            count(*) FILTER (WHERE status = 'failed') AS failed,
            count(*) FILTER (WHERE status NOT IN ('ready', 'failed')) AS in_flight
     FROM knowledge_sources
     WHERE workspace_id = $1 AND knowledge_base_id = $2`,
    [workspaceId, knowledgeBaseId],
    client,
  );
  return {
    total: Number(row?.total ?? 0),
    ready: Number(row?.ready ?? 0),
    failed: Number(row?.failed ?? 0),
    inFlight: Number(row?.in_flight ?? 0),
  };
}

export async function setKnowledgeBaseStatus(
  workspaceId: string,
  knowledgeBaseId: string,
  status: KnowledgeBaseStatus,
  client?: Queryable,
): Promise<void> {
  await query(
    "UPDATE knowledge_bases SET status = $3 WHERE workspace_id = $1 AND id = $2 AND status <> $3",
    [workspaceId, knowledgeBaseId, status],
    client,
  );
}

/* -------------------------------------------------------------------------- */
/* Sources                                                                    */
/* -------------------------------------------------------------------------- */

interface KnowledgeSourceRow {
  id: string;
  knowledge_base_id: string;
  type: KnowledgeSourceType;
  name: string;
  uri: string | null;
  status: KnowledgeSourceStatus;
  chunk_count: number;
  token_count: number;
  character_count: string | number | null;
  error: string | null;
  content_preview: string | null;
  metadata: KnowledgeSourceMetadata | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * `content` itself is never selected: a source can hold hundreds of kilobytes
 * of text that the client has no use for, so only a short preview crosses the
 * boundary.
 */
const SELECT_SOURCE = `
  SELECT ks.id, ks.knowledge_base_id, ks.type, ks.name, ks.uri, ks.status, ks.chunk_count, ks.token_count,
         coalesce(length(ks.content), 0) AS character_count, ks.error,
         left(ks.content, ${CONTENT_PREVIEW_CHARS}) AS content_preview,
         ks.metadata, ks.created_at, ks.updated_at
  FROM knowledge_sources ks
`;

function mapSource(row: KnowledgeSourceRow): KnowledgeSource {
  return {
    id: row.id,
    knowledgeBaseId: row.knowledge_base_id,
    type: row.type,
    name: row.name,
    uri: row.uri,
    status: row.status,
    chunkCount: Number(row.chunk_count ?? 0),
    tokenCount: Number(row.token_count ?? 0),
    characterCount: Number(row.character_count ?? 0),
    error: row.error,
    contentPreview: row.content_preview,
    metadata: row.metadata ?? {},
    createdAt: toIsoRequired(row.created_at),
    updatedAt: toIsoRequired(row.updated_at),
  };
}

export async function listKnowledgeSources(
  workspaceId: string,
  knowledgeBaseId: string,
  filters: KnowledgeSourceListFilters,
): Promise<Paginated<KnowledgeSource>> {
  const page = normalizePage(filters);
  const [rows, countRow] = await Promise.all([
    query<KnowledgeSourceRow>(
      `${SELECT_SOURCE} WHERE ks.workspace_id = $1 AND ks.knowledge_base_id = $2
       ORDER BY ks.created_at DESC LIMIT $3 OFFSET $4`,
      [workspaceId, knowledgeBaseId, page.pageSize, page.offset],
    ),
    queryOne<{ count: string }>(
      "SELECT count(*) AS count FROM knowledge_sources WHERE workspace_id = $1 AND knowledge_base_id = $2",
      [workspaceId, knowledgeBaseId],
    ),
  ]);
  return toPaginated(rows.map(mapSource), Number(countRow?.count ?? 0), page);
}

export async function findSourceById(
  workspaceId: string,
  sourceId: string,
  client?: Queryable,
): Promise<KnowledgeSource | null> {
  const row = await queryOne<KnowledgeSourceRow>(
    `${SELECT_SOURCE} WHERE ks.workspace_id = $1 AND ks.id = $2`,
    [workspaceId, sourceId],
    client,
  );
  return row ? mapSource(row) : null;
}

/** Full text of a source, read only inside the pipeline. */
export async function getSourceContent(workspaceId: string, sourceId: string, client?: Queryable): Promise<string | null> {
  const row = await queryOne<{ content: string | null }>(
    "SELECT content FROM knowledge_sources WHERE workspace_id = $1 AND id = $2",
    [workspaceId, sourceId],
    client,
  );
  return row?.content ?? null;
}

export interface InsertSourceInput {
  workspaceId: string;
  knowledgeBaseId: string;
  type: KnowledgeSourceType;
  name: string;
  uri: string | null;
  content: string | null;
  metadata: KnowledgeSourceMetadata;
}

export async function insertKnowledgeSource(input: InsertSourceInput, client?: Queryable): Promise<KnowledgeSource> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO knowledge_sources (workspace_id, knowledge_base_id, type, name, uri, content, metadata, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending') RETURNING id`,
    [
      input.workspaceId,
      input.knowledgeBaseId,
      input.type,
      input.name,
      input.uri,
      input.content,
      input.metadata,
    ],
    client,
  );
  if (!row) throw new Error("Failed to insert knowledge source");
  const source = await findSourceById(input.workspaceId, row.id, client);
  if (!source) throw new Error("Knowledge source vanished after insert");
  return source;
}

export async function setSourceStatus(
  workspaceId: string,
  sourceId: string,
  status: KnowledgeSourceStatus,
  options: { error?: string | null } = {},
  client?: Queryable,
): Promise<void> {
  await query(
    "UPDATE knowledge_sources SET status = $3, error = $4 WHERE workspace_id = $1 AND id = $2",
    [workspaceId, sourceId, status, options.error ?? null],
    client,
  );
}

export async function setSourceContent(
  workspaceId: string,
  sourceId: string,
  content: string,
  metadata: KnowledgeSourceMetadata,
  options: { name?: string; uri?: string } = {},
  client?: Queryable,
): Promise<void> {
  const params = new ParamBuilder();
  const sets = [
    `content = ${params.add(content)}`,
    // Merging keeps ingestion details (final URL, content type) alongside the
    // upload details recorded when the source was created.
    `metadata = metadata || ${params.add(metadata)}::jsonb`,
  ];
  if (options.name !== undefined) sets.push(`name = ${params.add(options.name)}`);
  if (options.uri !== undefined) sets.push(`uri = ${params.add(options.uri)}`);
  await query(
    `UPDATE knowledge_sources SET ${sets.join(", ")} WHERE workspace_id = ${params.add(workspaceId)} AND id = ${params.add(sourceId)}`,
    params.values,
    client,
  );
}

export async function setSourceCounts(
  workspaceId: string,
  sourceId: string,
  counts: { chunkCount: number; tokenCount: number },
  client?: Queryable,
): Promise<void> {
  await query(
    "UPDATE knowledge_sources SET chunk_count = $3, token_count = $4 WHERE workspace_id = $1 AND id = $2",
    [workspaceId, sourceId, counts.chunkCount, counts.tokenCount],
    client,
  );
}

export async function deleteSourceRow(workspaceId: string, sourceId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    "DELETE FROM knowledge_sources WHERE workspace_id = $1 AND id = $2 RETURNING id",
    [workspaceId, sourceId],
  );
  return rows.length > 0;
}

/** Ids of every source in a knowledge base, oldest first, for reprocess-all. */
export async function listSourceIds(workspaceId: string, knowledgeBaseId: string): Promise<string[]> {
  const rows = await query<{ id: string }>(
    "SELECT id FROM knowledge_sources WHERE workspace_id = $1 AND knowledge_base_id = $2 ORDER BY created_at",
    [workspaceId, knowledgeBaseId],
  );
  return rows.map((row) => row.id);
}

export async function markSourcesPending(workspaceId: string, knowledgeBaseId: string): Promise<void> {
  await query(
    "UPDATE knowledge_sources SET status = 'pending', error = NULL WHERE workspace_id = $1 AND knowledge_base_id = $2",
    [workspaceId, knowledgeBaseId],
  );
}

/* -------------------------------------------------------------------------- */
/* Chunks                                                                     */
/* -------------------------------------------------------------------------- */

export interface ChunkInsert {
  position: number;
  content: string;
  tokenCount: number;
}

export async function deleteSourceChunks(workspaceId: string, sourceId: string, client?: Queryable): Promise<void> {
  await query("DELETE FROM knowledge_chunks WHERE workspace_id = $1 AND source_id = $2", [workspaceId, sourceId], client);
}

/**
 * Replaces a source's chunks. Chunks are derived data, so the delete and the
 * insert must land together or a reader could observe a half-indexed source.
 * Returns the new chunk ids in position order so embeddings can be attached.
 */
export async function replaceSourceChunks(
  workspaceId: string,
  knowledgeBaseId: string,
  sourceId: string,
  chunks: ChunkInsert[],
  client: Queryable,
): Promise<string[]> {
  await deleteSourceChunks(workspaceId, sourceId, client);
  if (chunks.length === 0) return [];
  const params = new ParamBuilder();
  const values = chunks.map(
    (chunk) =>
      `(${params.add(workspaceId)}, ${params.add(knowledgeBaseId)}, ${params.add(sourceId)}, ${params.add(chunk.position)}, ${params.add(chunk.content)}, ${params.add(chunk.tokenCount)})`,
  );
  const rows = await query<{ id: string }>(
    `INSERT INTO knowledge_chunks (workspace_id, knowledge_base_id, source_id, position, content, token_count)
     VALUES ${values.join(", ")} RETURNING id`,
    params.values,
    client,
  );
  return rows.map((row) => row.id);
}

export interface ChunkEmbedding {
  chunkId: string;
  embedding: number[];
}

/**
 * Attaches vectors to chunks one batch per statement. A large document
 * produces hundreds of chunks, and a round-trip per chunk dominates the
 * pipeline's runtime.
 */
export async function setChunkEmbeddings(
  workspaceId: string,
  entries: ChunkEmbedding[],
  client?: Queryable,
): Promise<void> {
  if (entries.length === 0) return;
  const params = new ParamBuilder();
  const workspaceParam = params.add(workspaceId);
  const rows = entries.map((entry, index) => {
    const id = params.add(entry.chunkId);
    const embedding = params.add(entry.embedding);
    // Postgres infers the VALUES column types from the first row only.
    return index === 0 ? `(${id}::uuid, ${embedding}::double precision[])` : `(${id}, ${embedding})`;
  });
  await query(
    `UPDATE knowledge_chunks AS kc SET embedding = v.embedding
     FROM (VALUES ${rows.join(", ")}) AS v(id, embedding)
     WHERE kc.workspace_id = ${workspaceParam} AND kc.id = v.id`,
    params.values,
    client,
  );
}
