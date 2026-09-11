import { sql } from "drizzle-orm";
import { doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { collectionStatus, knowledgeSourceStatus, knowledgeSourceType } from "@/server/db/schema/columns";
import { users } from "@/server/db/schema/identity";
import { workspaces } from "@/server/db/schema/tenancy";

/**
 * A collection is a named, logical grouping of documents inside a workspace,
 * and nothing more. It holds no retrieval settings and no embedding
 * configuration: those describe how content is indexed, which is a property of
 * the document (below) and of the agent doing the retrieving, not of the
 * grouping someone chose for their own convenience. See migration 0016.
 *
 * `status` is the one exception, and it is a rollup rather than configuration —
 * it is recomputed from the documents in the collection, never set directly.
 */
export const knowledgeCollections = pgTable(
  "knowledge_collections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    status: collectionStatus("status").notNull().default("empty"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("knowledge_collections_workspace_id_idx").on(table.workspaceId, table.updatedAt.desc())],
);

/**
 * A document. `collectionId` is nullable on purpose: NULL is the Unorganized
 * bucket, holding documents that have been added and indexed but not yet filed.
 *
 * The foreign key is ON DELETE SET NULL, which is the difference between a
 * collection and a folder — deleting a collection un-files its documents
 * instead of destroying them.
 *
 * `embeddingConfig` records how this document's vectors were produced, so a
 * later provider or dimension change is detectable per document rather than
 * silently mixing incompatible vectors. It lives here, beside the vectors,
 * rather than on the collection, so that filing a document somewhere else
 * cannot appear to change how it was indexed.
 */
export const knowledgeSources = pgTable(
  "knowledge_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    collectionId: uuid("collection_id").references(() => knowledgeCollections.id, { onDelete: "set null" }),
    type: knowledgeSourceType("type").notNull(),
    name: text("name").notNull(),
    uri: text("uri"),
    content: text("content"),
    status: knowledgeSourceStatus("status").notNull().default("pending"),
    chunkCount: integer("chunk_count").notNull().default(0),
    tokenCount: integer("token_count").notNull().default(0),
    error: text("error"),
    metadata: jsonb("metadata").notNull().default({}),
    embeddingConfig: jsonb("embedding_config").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("knowledge_sources_collection_idx").on(table.collectionId, table.createdAt.desc()),
    // All Knowledge reads every document in the workspace, newest first.
    index("knowledge_sources_workspace_created_idx").on(table.workspaceId, table.createdAt.desc()),
    // Unorganized is a working queue people empty, so it is read far more often
    // than its size suggests.
    index("knowledge_sources_unorganized_idx")
      .on(table.workspaceId, table.createdAt.desc())
      .where(sql`${table.collectionId} IS NULL`),
  ],
);

/**
 * Chunks are derived data: replaced wholesale when a source is reprocessed.
 *
 * `collectionId` is denormalized from the source so retrieval can scope to a
 * set of collections with an index scan instead of joining. It must be kept in
 * step whenever a document is filed or moved — see `moveSourceToCollection()`
 * in the repository, which updates both in one transaction.
 *
 * `embedding` is a plain double precision array rather than a pgvector column
 * so the schema runs on a stock PostgreSQL. Retrieval ranks with full-text
 * search today; the stored vectors let a vector index be added later without
 * re-ingesting anything.
 */
export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    collectionId: uuid("collection_id").references(() => knowledgeCollections.id, { onDelete: "set null" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    content: text("content").notNull(),
    tokenCount: integer("token_count").notNull().default(0),
    embedding: doublePrecision("embedding").array(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("knowledge_chunks_collection_position_idx").on(table.collectionId, table.position),
    index("knowledge_chunks_source_idx").on(table.sourceId, table.position),
    index("knowledge_chunks_workspace_idx").on(table.workspaceId),
    // The expression must match retrieveKnowledge() exactly or the index is unusable.
    index("knowledge_chunks_content_fts_idx").using("gin", sql`to_tsvector('english', ${table.content})`),
  ],
);
