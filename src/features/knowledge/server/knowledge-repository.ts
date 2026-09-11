import "server-only";

import { CONTENT_PREVIEW_CHARS, DEFAULT_EMBEDDING_CONFIG } from "@/features/knowledge/constants";
import type {
  Collection,
  CollectionListFilters,
  CollectionStatus,
  CollectionSummary,
  KnowledgeEmbeddingConfig,
  KnowledgeScope,
  KnowledgeSource,
  KnowledgeSourceListFilters,
  KnowledgeSourceMetadata,
  KnowledgeSourceStatus,
  KnowledgeSourceType,
} from "@/features/knowledge/types";
import { query, queryOne, withWorkspace, type Queryable } from "@/server/db/client";
import { likePattern, normalizePage, ParamBuilder, toIsoRequired, toPaginated } from "@/server/db/sql";
import type { Paginated } from "@/types/pagination";

/* -------------------------------------------------------------------------- */
/* Collections                                                                */
/* -------------------------------------------------------------------------- */

interface CollectionRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  status: CollectionStatus;
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
const SELECT_COLLECTION = `
  SELECT c.id, c.workspace_id, c.name, c.description, c.status, c.created_at, c.updated_at,
         (SELECT count(*) FROM knowledge_sources ks WHERE ks.collection_id = c.id) AS source_count,
         (SELECT count(*) FROM knowledge_sources ks WHERE ks.collection_id = c.id AND ks.status = 'ready') AS ready_source_count,
         (SELECT count(*) FROM knowledge_sources ks WHERE ks.collection_id = c.id AND ks.status = 'failed') AS failed_source_count,
         (SELECT coalesce(sum(ks.chunk_count), 0) FROM knowledge_sources ks WHERE ks.collection_id = c.id) AS chunk_count,
         (SELECT coalesce(sum(ks.token_count), 0) FROM knowledge_sources ks WHERE ks.collection_id = c.id) AS token_count,
         (SELECT count(*) FROM chatbot_collections cc WHERE cc.collection_id = c.id) AS attached_chatbot_count,
         (SELECT count(*) FROM agent_collections ac WHERE ac.collection_id = c.id) AS attached_agent_count
  FROM knowledge_collections c
`;

function mapCollection(row: CollectionRow): Collection {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    status: row.status,
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

function toSummary(collection: Collection): CollectionSummary {
  return {
    id: collection.id,
    name: collection.name,
    description: collection.description,
    status: collection.status,
    sourceCount: collection.sourceCount,
    readySourceCount: collection.readySourceCount,
    failedSourceCount: collection.failedSourceCount,
    chunkCount: collection.chunkCount,
    tokenCount: collection.tokenCount,
    createdAt: collection.createdAt,
    updatedAt: collection.updatedAt,
  };
}

export async function listCollections(
  workspaceId: string,
  filters: CollectionListFilters,
): Promise<Paginated<CollectionSummary>> {
  const page = normalizePage(filters);
  const params = new ParamBuilder();
  const where: string[] = [`c.workspace_id = ${params.add(workspaceId)}`];
  if (filters.status) where.push(`c.status = ${params.add(filters.status)}`);
  if (filters.q) {
    const pattern = params.add(likePattern(filters.q));
    where.push(`(c.name ILIKE ${pattern} OR c.description ILIKE ${pattern})`);
  }
  const whereSql = where.join(" AND ");
  // Captured before the limit/offset params are appended, so the count query
  // and the page query cannot drift.
  const whereParams = [...params.values];

  const [rows, countRow] = await Promise.all([
    query<CollectionRow>(
      `${SELECT_COLLECTION} WHERE ${whereSql} ORDER BY c.updated_at DESC LIMIT ${params.add(page.pageSize)} OFFSET ${params.add(page.offset)}`,
      params.values,
    ),
    queryOne<{ count: string }>(`SELECT count(*) AS count FROM knowledge_collections c WHERE ${whereSql}`, whereParams),
  ]);

  return toPaginated(rows.map(mapCollection).map(toSummary), Number(countRow?.count ?? 0), page);
}

export async function findCollectionById(
  workspaceId: string,
  collectionId: string,
  client?: Queryable,
): Promise<Collection | null> {
  const row = await queryOne<CollectionRow>(
    `${SELECT_COLLECTION} WHERE c.workspace_id = $1 AND c.id = $2`,
    [workspaceId, collectionId],
    client,
  );
  return row ? mapCollection(row) : null;
}

/**
 * Names for a set of collection ids, for listings that span collections.
 * Returns only ids that exist in this workspace, which is also how the service
 * validates an attachment request.
 */
export async function listCollectionOptions(workspaceId: string): Promise<Array<{ id: string; name: string }>> {
  return query<{ id: string; name: string }>(
    "SELECT id, name FROM knowledge_collections WHERE workspace_id = $1 ORDER BY name",
    [workspaceId],
  );
}

export interface InsertCollectionInput {
  workspaceId: string;
  createdBy: string;
  name: string;
  description: string | null;
}

export async function insertCollection(input: InsertCollectionInput, client?: Queryable): Promise<Collection> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO knowledge_collections (workspace_id, created_by, name, description)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [input.workspaceId, input.createdBy, input.name, input.description],
    client,
  );
  if (!row) throw new Error("Failed to insert collection");
  const collection = await findCollectionById(input.workspaceId, row.id, client);
  if (!collection) throw new Error("Collection vanished after insert");
  return collection;
}

export interface CollectionPatch {
  name?: string;
  description?: string | null;
}

export async function updateCollectionRow(
  workspaceId: string,
  collectionId: string,
  patch: CollectionPatch,
  client?: Queryable,
): Promise<void> {
  const params = new ParamBuilder();
  const sets: string[] = [];
  if (patch.name !== undefined) sets.push(`name = ${params.add(patch.name)}`);
  if (patch.description !== undefined) sets.push(`description = ${params.add(patch.description)}`);
  if (sets.length === 0) return;
  await query(
    `UPDATE knowledge_collections SET ${sets.join(", ")} WHERE workspace_id = ${params.add(workspaceId)} AND id = ${params.add(collectionId)}`,
    params.values,
    client,
  );
}

/**
 * Deleting a collection un-files its documents rather than destroying them:
 * both foreign keys are ON DELETE SET NULL (migration 0016). That is the whole
 * difference between a collection and a folder, so it is the database that
 * enforces it, not this function.
 */
export async function deleteCollectionRow(workspaceId: string, collectionId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    "DELETE FROM knowledge_collections WHERE workspace_id = $1 AND id = $2 RETURNING id",
    [workspaceId, collectionId],
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
  collectionId: string,
  client?: Queryable,
): Promise<SourceStatusCounts> {
  const row = await queryOne<{ total: string; ready: string; failed: string; in_flight: string }>(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE status = 'ready') AS ready,
            count(*) FILTER (WHERE status = 'failed') AS failed,
            count(*) FILTER (WHERE status NOT IN ('ready', 'failed')) AS in_flight
     FROM knowledge_sources
     WHERE workspace_id = $1 AND collection_id = $2`,
    [workspaceId, collectionId],
    client,
  );
  return {
    total: Number(row?.total ?? 0),
    ready: Number(row?.ready ?? 0),
    failed: Number(row?.failed ?? 0),
    inFlight: Number(row?.in_flight ?? 0),
  };
}

export async function setCollectionStatus(
  workspaceId: string,
  collectionId: string,
  status: CollectionStatus,
  client?: Queryable,
): Promise<void> {
  await query(
    "UPDATE knowledge_collections SET status = $3 WHERE workspace_id = $1 AND id = $2 AND status <> $3",
    [workspaceId, collectionId, status],
    client,
  );
}

/** How many documents are waiting to be filed. Drives the Unorganized card. */
export async function countUnorganizedSources(workspaceId: string): Promise<number> {
  const row = await queryOne<{ count: string }>(
    "SELECT count(*) AS count FROM knowledge_sources WHERE workspace_id = $1 AND collection_id IS NULL",
    [workspaceId],
  );
  return Number(row?.count ?? 0);
}

/* -------------------------------------------------------------------------- */
/* Sources                                                                    */
/* -------------------------------------------------------------------------- */

interface KnowledgeSourceRow {
  id: string;
  collection_id: string | null;
  collection_name: string | null;
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
 *
 * The join is LEFT because an unorganized source has no collection, and a plain
 * join would silently drop exactly the documents the Unorganized view exists to
 * show.
 */
const SELECT_SOURCE = `
  SELECT ks.id, ks.collection_id, c.name AS collection_name, ks.type, ks.name, ks.uri, ks.status,
         ks.chunk_count, ks.token_count,
         coalesce(length(ks.content), 0) AS character_count, ks.error,
         left(ks.content, ${CONTENT_PREVIEW_CHARS}) AS content_preview,
         ks.metadata, ks.created_at, ks.updated_at
  FROM knowledge_sources ks
  LEFT JOIN knowledge_collections c ON c.id = ks.collection_id AND c.workspace_id = ks.workspace_id
`;

function mapSource(row: KnowledgeSourceRow): KnowledgeSource {
  return {
    id: row.id,
    collectionId: row.collection_id,
    collectionName: row.collection_name,
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

/**
 * Turns a scope into a SQL predicate. `all` adds nothing, `unorganized` is an
 * IS NULL test rather than an equality against a placeholder id, and a
 * collection scope is a plain equality.
 */
function scopePredicate(scope: KnowledgeScope, params: ParamBuilder): string | null {
  switch (scope.kind) {
    case "all":
      return null;
    case "unorganized":
      return "ks.collection_id IS NULL";
    case "collection":
      return `ks.collection_id = ${params.add(scope.collectionId)}`;
  }
}

export async function listKnowledgeSources(
  workspaceId: string,
  scope: KnowledgeScope,
  filters: KnowledgeSourceListFilters,
): Promise<Paginated<KnowledgeSource>> {
  const page = normalizePage(filters);
  const params = new ParamBuilder();
  const where: string[] = [`ks.workspace_id = ${params.add(workspaceId)}`];

  const scopeSql = scopePredicate(scope, params);
  if (scopeSql) where.push(scopeSql);
  if (filters.status) where.push(`ks.status = ${params.add(filters.status)}`);
  if (filters.q) {
    const pattern = params.add(likePattern(filters.q));
    where.push(`(ks.name ILIKE ${pattern} OR ks.uri ILIKE ${pattern})`);
  }

  const whereSql = where.join(" AND ");
  const whereParams = [...params.values];

  const [rows, countRow] = await Promise.all([
    query<KnowledgeSourceRow>(
      `${SELECT_SOURCE} WHERE ${whereSql} ORDER BY ks.created_at DESC
       LIMIT ${params.add(page.pageSize)} OFFSET ${params.add(page.offset)}`,
      params.values,
    ),
    queryOne<{ count: string }>(`SELECT count(*) AS count FROM knowledge_sources ks WHERE ${whereSql}`, whereParams),
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
  /** NULL adds the document to Unorganized. */
  collectionId: string | null;
  type: KnowledgeSourceType;
  name: string;
  uri: string | null;
  content: string | null;
  metadata: KnowledgeSourceMetadata;
}

export async function insertKnowledgeSource(input: InsertSourceInput, client?: Queryable): Promise<KnowledgeSource> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO knowledge_sources (workspace_id, collection_id, type, name, uri, content, metadata, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending') RETURNING id`,
    [input.workspaceId, input.collectionId, input.type, input.name, input.uri, input.content, input.metadata],
    client,
  );
  if (!row) throw new Error("Failed to insert knowledge source");
  const source = await findSourceById(input.workspaceId, row.id, client);
  if (!source) throw new Error("Knowledge source vanished after insert");
  return source;
}

/**
 * Files a document into a collection, or back into Unorganized with NULL.
 *
 * The chunks carry a denormalized `collection_id` so retrieval can scope with
 * an index scan, which means moving a document is two writes that must land
 * together: a chunk left pointing at the old collection is content retrievable
 * from a collection it is no longer in, which is a tenant-visible correctness
 * bug rather than a cosmetic one.
 */
export async function moveSourceToCollection(
  workspaceId: string,
  sourceId: string,
  collectionId: string | null,
): Promise<void> {
  await withWorkspace(workspaceId, async (client) => {
    await query(
      "UPDATE knowledge_sources SET collection_id = $3 WHERE workspace_id = $1 AND id = $2",
      [workspaceId, sourceId, collectionId],
      client,
    );
    await query(
      "UPDATE knowledge_chunks SET collection_id = $3 WHERE workspace_id = $1 AND source_id = $2",
      [workspaceId, sourceId, collectionId],
      client,
    );
  });
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
  embeddingConfig: KnowledgeEmbeddingConfig,
  client?: Queryable,
): Promise<void> {
  await query(
    `UPDATE knowledge_sources SET chunk_count = $3, token_count = $4, embedding_config = $5
     WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, sourceId, counts.chunkCount, counts.tokenCount, embeddingConfig],
    client,
  );
}

/** How a document's vectors were produced, as recorded by its last indexing run. */
export async function getSourceEmbeddingConfig(
  workspaceId: string,
  sourceId: string,
  client?: Queryable,
): Promise<KnowledgeEmbeddingConfig> {
  const row = await queryOne<{ embedding_config: Partial<KnowledgeEmbeddingConfig> | null }>(
    "SELECT embedding_config FROM knowledge_sources WHERE workspace_id = $1 AND id = $2",
    [workspaceId, sourceId],
    client,
  );
  return { ...DEFAULT_EMBEDDING_CONFIG, ...(row?.embedding_config ?? {}) };
}

export async function deleteSourceRow(workspaceId: string, sourceId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    "DELETE FROM knowledge_sources WHERE workspace_id = $1 AND id = $2 RETURNING id",
    [workspaceId, sourceId],
  );
  return rows.length > 0;
}

/** Ids of every source in a collection, oldest first, for reprocess-all. */
export async function listSourceIds(workspaceId: string, collectionId: string): Promise<string[]> {
  const rows = await query<{ id: string }>(
    "SELECT id FROM knowledge_sources WHERE workspace_id = $1 AND collection_id = $2 ORDER BY created_at",
    [workspaceId, collectionId],
  );
  return rows.map((row) => row.id);
}

export async function markSourcesPending(workspaceId: string, collectionId: string): Promise<void> {
  await query(
    "UPDATE knowledge_sources SET status = 'pending', error = NULL WHERE workspace_id = $1 AND collection_id = $2",
    [workspaceId, collectionId],
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
  collectionId: string | null,
  sourceId: string,
  chunks: ChunkInsert[],
  client: Queryable,
): Promise<string[]> {
  await deleteSourceChunks(workspaceId, sourceId, client);
  if (chunks.length === 0) return [];
  const params = new ParamBuilder();
  const values = chunks.map(
    (chunk) =>
      `(${params.add(workspaceId)}, ${params.add(collectionId)}, ${params.add(sourceId)}, ${params.add(chunk.position)}, ${params.add(chunk.content)}, ${params.add(chunk.tokenCount)})`,
  );
  const rows = await query<{ id: string }>(
    `INSERT INTO knowledge_chunks (workspace_id, collection_id, source_id, position, content, token_count)
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
