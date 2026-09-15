import "server-only";

import { and, asc, count, desc, eq, ilike, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/pg-core";

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
import { query, withDb, withWorkspace, type DatabaseClient } from "@/server/db/client";
import {
  agentCollections,
  chatbotCollections,
  knowledgeChunks,
  knowledgeCollections,
  knowledgeSources,
} from "@/server/db/schema";
import { likePattern, normalizePage, ParamBuilder, toIsoRequired, toPaginated } from "@/server/db/sql";
import type { Paginated } from "@/types/pagination";

/** Connection-less builder, used only to COMPOSE correlated subqueries. */
const qb = new QueryBuilder();

/* -------------------------------------------------------------------------- */
/* Collections                                                                */
/* -------------------------------------------------------------------------- */

interface CollectionRow {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  status: CollectionStatus;
  createdAt: Date;
  updatedAt: Date;
  sourceCount: number;
  readySourceCount: number;
  failedSourceCount: number;
  chunkCount: number;
  tokenCount: number;
  attachedChatbotCount: number;
  attachedAgentCount: number;
}

/**
 * Counts come from correlated subqueries rather than a denormalized column so
 * they can never drift from the rows they describe.
 *
 * Every one is COMPOSED with the query builder rather than written as a single
 * `sql` template. That is load-bearing: in a select list with no join, Drizzle
 * renders an interpolated column without its table name, so a template would
 * emit `WHERE "collection_id" = "id"` - both columns of the INNER table, which
 * counts the wrong thing silently. Composed this way the outer reference stays
 * qualified as `"knowledge_collections"."id"`.
 */
const sourcesIn = (extra?: SQL) =>
  and(eq(knowledgeSources.collectionId, knowledgeCollections.id), extra);

const collectionSelection = {
  id: knowledgeCollections.id,
  workspaceId: knowledgeCollections.workspaceId,
  name: knowledgeCollections.name,
  description: knowledgeCollections.description,
  status: knowledgeCollections.status,
  createdAt: knowledgeCollections.createdAt,
  updatedAt: knowledgeCollections.updatedAt,
  sourceCount: sql<number>`${qb.select({ c: sql`count(*)` }).from(knowledgeSources).where(sourcesIn())}`.mapWith(Number),
  readySourceCount: sql<number>`${qb
    .select({ c: sql`count(*)` })
    .from(knowledgeSources)
    .where(sourcesIn(eq(knowledgeSources.status, "ready")))}`.mapWith(Number),
  failedSourceCount: sql<number>`${qb
    .select({ c: sql`count(*)` })
    .from(knowledgeSources)
    .where(sourcesIn(eq(knowledgeSources.status, "failed")))}`.mapWith(Number),
  chunkCount: sql<number>`${qb
    .select({ c: sql`coalesce(sum(${knowledgeSources.chunkCount}), 0)` })
    .from(knowledgeSources)
    .where(sourcesIn())}`.mapWith(Number),
  tokenCount: sql<number>`${qb
    .select({ c: sql`coalesce(sum(${knowledgeSources.tokenCount}), 0)` })
    .from(knowledgeSources)
    .where(sourcesIn())}`.mapWith(Number),
  attachedChatbotCount: sql<number>`${qb
    .select({ c: sql`count(*)` })
    .from(chatbotCollections)
    .where(eq(chatbotCollections.collectionId, knowledgeCollections.id))}`.mapWith(Number),
  attachedAgentCount: sql<number>`${qb
    .select({ c: sql`count(*)` })
    .from(agentCollections)
    .where(eq(agentCollections.collectionId, knowledgeCollections.id))}`.mapWith(Number),
};

function mapCollection(row: CollectionRow): Collection {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    description: row.description,
    status: row.status,
    sourceCount: Number(row.sourceCount ?? 0),
    readySourceCount: Number(row.readySourceCount ?? 0),
    failedSourceCount: Number(row.failedSourceCount ?? 0),
    chunkCount: Number(row.chunkCount ?? 0),
    tokenCount: Number(row.tokenCount ?? 0),
    attachedChatbotCount: Number(row.attachedChatbotCount ?? 0),
    attachedAgentCount: Number(row.attachedAgentCount ?? 0),
    createdAt: toIsoRequired(row.createdAt),
    updatedAt: toIsoRequired(row.updatedAt),
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

export async function listCollections(workspaceId: string, filters: CollectionListFilters): Promise<Paginated<CollectionSummary>> {
  const page = normalizePage(filters);

  // Built once and shared by the page query and the count, so the two cannot
  // drift the way the old positional-parameter slicing allowed.
  const conditions: Array<SQL | undefined> = [eq(knowledgeCollections.workspaceId, workspaceId)];
  if (filters.status) conditions.push(eq(knowledgeCollections.status, filters.status));
  if (filters.q) {
    const pattern = likePattern(filters.q);
    conditions.push(or(ilike(knowledgeCollections.name, pattern), ilike(knowledgeCollections.description, pattern)));
  }
  const where = and(...conditions);

  const [rows, totals] = await Promise.all([
    withDb((db) =>
      db
        .select(collectionSelection)
        .from(knowledgeCollections)
        .where(where)
        .orderBy(desc(knowledgeCollections.updatedAt))
        .limit(page.pageSize)
        .offset(page.offset),
    ),
    withDb((db) => db.select({ total: count() }).from(knowledgeCollections).where(where)),
  ]);

  return toPaginated(rows.map(mapCollection).map(toSummary), totals[0]?.total ?? 0, page);
}

export async function findCollectionById(
  workspaceId: string,
  collectionId: string,
  client?: DatabaseClient,
): Promise<Collection | null> {
  const rows = await withDb(
    (db) =>
      db
        .select(collectionSelection)
        .from(knowledgeCollections)
        .where(and(eq(knowledgeCollections.workspaceId, workspaceId), eq(knowledgeCollections.id, collectionId)))
        .limit(1),
    client,
  );
  return rows[0] ? mapCollection(rows[0]) : null;
}

/**
 * Names for a set of collection ids, for listings that span collections.
 * Returns only ids that exist in this workspace, which is also how the service
 * validates an attachment request.
 */
export async function listCollectionOptions(workspaceId: string): Promise<Array<{ id: string; name: string }>> {
  return withDb((db) =>
    db
      .select({ id: knowledgeCollections.id, name: knowledgeCollections.name })
      .from(knowledgeCollections)
      .where(eq(knowledgeCollections.workspaceId, workspaceId))
      .orderBy(asc(knowledgeCollections.name)),
  );
}

export interface InsertCollectionInput {
  workspaceId: string;
  createdBy: string;
  name: string;
  description: string | null;
}

export async function insertCollection(input: InsertCollectionInput, client?: DatabaseClient): Promise<Collection> {
  const inserted = await withDb(
    (db) =>
      db
        .insert(knowledgeCollections)
        .values({
          workspaceId: input.workspaceId,
          createdBy: input.createdBy,
          name: input.name,
          description: input.description,
        })
        .returning({ id: knowledgeCollections.id }),
    client,
  );
  const id = inserted[0]?.id;
  if (!id) throw new Error("Failed to insert collection");
  const collection = await findCollectionById(input.workspaceId, id, client);
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
  client?: DatabaseClient,
): Promise<void> {
  const values: Partial<typeof knowledgeCollections.$inferInsert> = {};
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.description !== undefined) values.description = patch.description;
  if (Object.keys(values).length === 0) return;

  await withDb(
    (db) =>
      db
        .update(knowledgeCollections)
        .set(values)
        .where(and(eq(knowledgeCollections.workspaceId, workspaceId), eq(knowledgeCollections.id, collectionId))),
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
  const rows = await withDb((db) =>
    db
      .delete(knowledgeCollections)
      .where(and(eq(knowledgeCollections.workspaceId, workspaceId), eq(knowledgeCollections.id, collectionId)))
      .returning({ id: knowledgeCollections.id }),
  );
  return rows.length > 0;
}

export interface SourceStatusCounts {
  total: number;
  ready: number;
  failed: number;
  inFlight: number;
}

/**
 * The four figures are `FILTER`ed aggregates over one pass of the collection's
 * documents: the alternative is four statements over the same rows.
 */
export async function countSourceStatuses(
  workspaceId: string,
  collectionId: string,
  client?: DatabaseClient,
): Promise<SourceStatusCounts> {
  const rows = await withDb(
    (db) =>
      db
        .select({
          total: count(),
          ready: sql<number>`count(*) FILTER (WHERE ${knowledgeSources.status} = 'ready')`.mapWith(Number),
          failed: sql<number>`count(*) FILTER (WHERE ${knowledgeSources.status} = 'failed')`.mapWith(Number),
          inFlight: sql<number>`count(*) FILTER (WHERE ${knowledgeSources.status} NOT IN ('ready', 'failed'))`.mapWith(Number),
        })
        .from(knowledgeSources)
        .where(and(eq(knowledgeSources.workspaceId, workspaceId), eq(knowledgeSources.collectionId, collectionId))),
    client,
  );
  const row = rows[0];
  return {
    total: Number(row?.total ?? 0),
    ready: Number(row?.ready ?? 0),
    failed: Number(row?.failed ?? 0),
    inFlight: Number(row?.inFlight ?? 0),
  };
}

export async function setCollectionStatus(
  workspaceId: string,
  collectionId: string,
  status: CollectionStatus,
  client?: DatabaseClient,
): Promise<void> {
  await withDb(
    (db) =>
      db
        .update(knowledgeCollections)
        .set({ status })
        // The inequality keeps a no-op rollup from touching `updated_at` and
        // reordering the list for no reason.
        .where(
          and(
            eq(knowledgeCollections.workspaceId, workspaceId),
            eq(knowledgeCollections.id, collectionId),
            ne(knowledgeCollections.status, status),
          ),
        ),
    client,
  );
}

/** How many documents are waiting to be filed. Drives the Unorganized card. */
export async function countUnorganizedSources(workspaceId: string): Promise<number> {
  const rows = await withDb((db) =>
    db
      .select({ total: count() })
      .from(knowledgeSources)
      .where(and(eq(knowledgeSources.workspaceId, workspaceId), isNull(knowledgeSources.collectionId))),
  );
  return rows[0]?.total ?? 0;
}

/* -------------------------------------------------------------------------- */
/* Sources                                                                    */
/* -------------------------------------------------------------------------- */

interface KnowledgeSourceRow {
  id: string;
  collectionId: string | null;
  collectionName: string | null;
  type: KnowledgeSourceType;
  name: string;
  uri: string | null;
  status: KnowledgeSourceStatus;
  chunkCount: number;
  tokenCount: number;
  characterCount: number | null;
  error: string | null;
  contentPreview: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * `content` itself is never selected: a source can hold hundreds of kilobytes
 * of text that the client has no use for, so only a short preview crosses the
 * boundary. `left()` and `length()` do that truncation in the database, which
 * is the point - selecting the column and slicing in TypeScript would ship the
 * whole document to do it.
 */
const sourceSelection = {
  id: knowledgeSources.id,
  collectionId: knowledgeSources.collectionId,
  collectionName: knowledgeCollections.name,
  type: knowledgeSources.type,
  name: knowledgeSources.name,
  uri: knowledgeSources.uri,
  status: knowledgeSources.status,
  chunkCount: knowledgeSources.chunkCount,
  tokenCount: knowledgeSources.tokenCount,
  characterCount: sql<number>`coalesce(length(${knowledgeSources.content}), 0)`.mapWith(Number),
  error: knowledgeSources.error,
  contentPreview: sql<string | null>`left(${knowledgeSources.content}, ${CONTENT_PREVIEW_CHARS})`,
  metadata: knowledgeSources.metadata,
  createdAt: knowledgeSources.createdAt,
  updatedAt: knowledgeSources.updatedAt,
};

/**
 * The join is LEFT because an unorganized source has no collection, and an
 * inner join would silently drop exactly the documents the Unorganized view
 * exists to show. It is additionally constrained to the same workspace.
 */
const collectionJoin = and(
  eq(knowledgeCollections.id, knowledgeSources.collectionId),
  eq(knowledgeCollections.workspaceId, knowledgeSources.workspaceId),
);

function mapSource(row: KnowledgeSourceRow): KnowledgeSource {
  return {
    id: row.id,
    collectionId: row.collectionId,
    collectionName: row.collectionName,
    type: row.type,
    name: row.name,
    uri: row.uri,
    status: row.status,
    chunkCount: Number(row.chunkCount ?? 0),
    tokenCount: Number(row.tokenCount ?? 0),
    characterCount: Number(row.characterCount ?? 0),
    error: row.error,
    contentPreview: row.contentPreview,
    metadata: (row.metadata ?? {}) as KnowledgeSourceMetadata,
    createdAt: toIsoRequired(row.createdAt),
    updatedAt: toIsoRequired(row.updatedAt),
  };
}

/**
 * Turns a scope into a predicate. `all` adds nothing, `unorganized` is an
 * IS NULL test rather than an equality against a placeholder id, and a
 * collection scope is a plain equality.
 */
function scopePredicate(scope: KnowledgeScope): SQL | undefined {
  switch (scope.kind) {
    case "all":
      return undefined;
    case "unorganized":
      return isNull(knowledgeSources.collectionId);
    case "collection":
      return eq(knowledgeSources.collectionId, scope.collectionId);
  }
}

export async function listKnowledgeSources(
  workspaceId: string,
  scope: KnowledgeScope,
  filters: KnowledgeSourceListFilters,
): Promise<Paginated<KnowledgeSource>> {
  const page = normalizePage(filters);

  const conditions: Array<SQL | undefined> = [eq(knowledgeSources.workspaceId, workspaceId), scopePredicate(scope)];
  if (filters.status) conditions.push(eq(knowledgeSources.status, filters.status));
  if (filters.q) {
    const pattern = likePattern(filters.q);
    conditions.push(or(ilike(knowledgeSources.name, pattern), ilike(knowledgeSources.uri, pattern)));
  }
  const where = and(...conditions);

  const [rows, totals] = await Promise.all([
    withDb((db) =>
      db
        .select(sourceSelection)
        .from(knowledgeSources)
        .leftJoin(knowledgeCollections, collectionJoin)
        .where(where)
        .orderBy(desc(knowledgeSources.createdAt))
        .limit(page.pageSize)
        .offset(page.offset),
    ),
    withDb((db) => db.select({ total: count() }).from(knowledgeSources).where(where)),
  ]);

  return toPaginated(rows.map(mapSource), totals[0]?.total ?? 0, page);
}

export async function findSourceById(
  workspaceId: string,
  sourceId: string,
  client?: DatabaseClient,
): Promise<KnowledgeSource | null> {
  const rows = await withDb(
    (db) =>
      db
        .select(sourceSelection)
        .from(knowledgeSources)
        .leftJoin(knowledgeCollections, collectionJoin)
        .where(and(eq(knowledgeSources.workspaceId, workspaceId), eq(knowledgeSources.id, sourceId)))
        .limit(1),
    client,
  );
  return rows[0] ? mapSource(rows[0]) : null;
}

/** Full text of a source, read only inside the pipeline. */
export async function getSourceContent(workspaceId: string, sourceId: string, client?: DatabaseClient): Promise<string | null> {
  const rows = await withDb(
    (db) =>
      db
        .select({ content: knowledgeSources.content })
        .from(knowledgeSources)
        .where(and(eq(knowledgeSources.workspaceId, workspaceId), eq(knowledgeSources.id, sourceId)))
        .limit(1),
    client,
  );
  return rows[0]?.content ?? null;
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

export async function insertKnowledgeSource(input: InsertSourceInput, client?: DatabaseClient): Promise<KnowledgeSource> {
  const inserted = await withDb(
    (db) =>
      db
        .insert(knowledgeSources)
        .values({
          workspaceId: input.workspaceId,
          collectionId: input.collectionId,
          type: input.type,
          name: input.name,
          uri: input.uri,
          content: input.content,
          metadata: input.metadata,
          status: "pending",
        })
        .returning({ id: knowledgeSources.id }),
    client,
  );
  const id = inserted[0]?.id;
  if (!id) throw new Error("Failed to insert knowledge source");
  const source = await findSourceById(input.workspaceId, id, client);
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
    await withDb(
      (db) =>
        db
          .update(knowledgeSources)
          .set({ collectionId })
          .where(and(eq(knowledgeSources.workspaceId, workspaceId), eq(knowledgeSources.id, sourceId))),
      client,
    );
    await withDb(
      (db) =>
        db
          .update(knowledgeChunks)
          .set({ collectionId })
          .where(and(eq(knowledgeChunks.workspaceId, workspaceId), eq(knowledgeChunks.sourceId, sourceId))),
      client,
    );
  });
}

export async function setSourceStatus(
  workspaceId: string,
  sourceId: string,
  status: KnowledgeSourceStatus,
  options: { error?: string | null } = {},
  client?: DatabaseClient,
): Promise<void> {
  await withDb(
    (db) =>
      db
        .update(knowledgeSources)
        .set({ status, error: options.error ?? null })
        .where(and(eq(knowledgeSources.workspaceId, workspaceId), eq(knowledgeSources.id, sourceId))),
    client,
  );
}

export async function setSourceContent(
  workspaceId: string,
  sourceId: string,
  content: string,
  metadata: KnowledgeSourceMetadata,
  options: { name?: string; uri?: string } = {},
  client?: DatabaseClient,
): Promise<void> {
  const values: Partial<typeof knowledgeSources.$inferInsert> = {
    content,
    // `||` is the jsonb concatenation operator: merging keeps ingestion details
    // (final URL, content type) alongside the upload details recorded when the
    // source was created, which an assignment would discard.
    metadata: sql`${knowledgeSources.metadata} || ${JSON.stringify(metadata)}::jsonb`,
  };
  if (options.name !== undefined) values.name = options.name;
  if (options.uri !== undefined) values.uri = options.uri;

  await withDb(
    (db) =>
      db
        .update(knowledgeSources)
        .set(values)
        .where(and(eq(knowledgeSources.workspaceId, workspaceId), eq(knowledgeSources.id, sourceId))),
    client,
  );
}

export async function setSourceCounts(
  workspaceId: string,
  sourceId: string,
  counts: { chunkCount: number; tokenCount: number },
  embeddingConfig: KnowledgeEmbeddingConfig,
  client?: DatabaseClient,
): Promise<void> {
  await withDb(
    (db) =>
      db
        .update(knowledgeSources)
        .set({ chunkCount: counts.chunkCount, tokenCount: counts.tokenCount, embeddingConfig })
        .where(and(eq(knowledgeSources.workspaceId, workspaceId), eq(knowledgeSources.id, sourceId))),
    client,
  );
}

/** How a document's vectors were produced, as recorded by its last indexing run. */
export async function getSourceEmbeddingConfig(
  workspaceId: string,
  sourceId: string,
  client?: DatabaseClient,
): Promise<KnowledgeEmbeddingConfig> {
  const rows = await withDb(
    (db) =>
      db
        .select({ embeddingConfig: knowledgeSources.embeddingConfig })
        .from(knowledgeSources)
        .where(and(eq(knowledgeSources.workspaceId, workspaceId), eq(knowledgeSources.id, sourceId)))
        .limit(1),
    client,
  );
  return { ...DEFAULT_EMBEDDING_CONFIG, ...((rows[0]?.embeddingConfig ?? {}) as Partial<KnowledgeEmbeddingConfig>) };
}

export async function deleteSourceRow(workspaceId: string, sourceId: string): Promise<boolean> {
  const rows = await withDb((db) =>
    db
      .delete(knowledgeSources)
      .where(and(eq(knowledgeSources.workspaceId, workspaceId), eq(knowledgeSources.id, sourceId)))
      .returning({ id: knowledgeSources.id }),
  );
  return rows.length > 0;
}

/** Ids of every source in a collection, oldest first, for reprocess-all. */
export async function listSourceIds(workspaceId: string, collectionId: string): Promise<string[]> {
  const rows = await withDb((db) =>
    db
      .select({ id: knowledgeSources.id })
      .from(knowledgeSources)
      .where(and(eq(knowledgeSources.workspaceId, workspaceId), eq(knowledgeSources.collectionId, collectionId)))
      .orderBy(asc(knowledgeSources.createdAt)),
  );
  return rows.map((row) => row.id);
}

export async function markSourcesPending(workspaceId: string, collectionId: string): Promise<void> {
  await withDb((db) =>
    db
      .update(knowledgeSources)
      .set({ status: "pending", error: null })
      .where(and(eq(knowledgeSources.workspaceId, workspaceId), eq(knowledgeSources.collectionId, collectionId))),
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

export async function deleteSourceChunks(workspaceId: string, sourceId: string, client?: DatabaseClient): Promise<void> {
  await withDb(
    (db) =>
      db.delete(knowledgeChunks).where(and(eq(knowledgeChunks.workspaceId, workspaceId), eq(knowledgeChunks.sourceId, sourceId))),
    client,
  );
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
  client: DatabaseClient,
): Promise<string[]> {
  await deleteSourceChunks(workspaceId, sourceId, client);
  if (chunks.length === 0) return [];
  // One multi-row INSERT, whose RETURNING comes back in the order the rows were
  // supplied - which is what lets the caller line the ids up with its chunks.
  const rows = await withDb(
    (db) =>
      db
        .insert(knowledgeChunks)
        .values(
          chunks.map((chunk) => ({
            workspaceId,
            collectionId,
            sourceId,
            position: chunk.position,
            content: chunk.content,
            tokenCount: chunk.tokenCount,
          })),
        )
        .returning({ id: knowledgeChunks.id }),
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
 *
 * Raw SQL, and the reason is the shape rather than any single function:
 * `UPDATE ... FROM (VALUES ...)` sets a different value on every row in one
 * statement. Drizzle's update takes one `set` for the whole statement, so the
 * builder can only express this as one statement per chunk - the exact cost
 * this batching exists to avoid.
 */
export async function setChunkEmbeddings(
  workspaceId: string,
  entries: ChunkEmbedding[],
  client?: DatabaseClient,
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
