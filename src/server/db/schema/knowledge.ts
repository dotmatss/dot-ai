import { sql } from "drizzle-orm";
import { doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { knowledgeBaseStatus, knowledgeSourceStatus, knowledgeSourceType } from "@/server/db/schema/columns";
import { users } from "@/server/db/schema/identity";
import { workspaces } from "@/server/db/schema/tenancy";

export const knowledgeBases = pgTable(
  "knowledge_bases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    status: knowledgeBaseStatus("status").notNull().default("empty"),
    embeddingConfig: jsonb("embedding_config").notNull().default({}),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("knowledge_bases_workspace_id_idx").on(table.workspaceId, table.updatedAt.desc())],
);

export const knowledgeSources = pgTable(
  "knowledge_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    knowledgeBaseId: uuid("knowledge_base_id")
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: "cascade" }),
    type: knowledgeSourceType("type").notNull(),
    name: text("name").notNull(),
    uri: text("uri"),
    content: text("content"),
    status: knowledgeSourceStatus("status").notNull().default("pending"),
    chunkCount: integer("chunk_count").notNull().default(0),
    tokenCount: integer("token_count").notNull().default(0),
    error: text("error"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("knowledge_sources_kb_idx").on(table.knowledgeBaseId, table.createdAt.desc()),
    index("knowledge_sources_workspace_idx").on(table.workspaceId),
  ],
);

/**
 * Chunks are derived data: replaced wholesale when a source is reprocessed.
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
    knowledgeBaseId: uuid("knowledge_base_id")
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: "cascade" }),
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
    index("knowledge_chunks_kb_position_idx").on(table.knowledgeBaseId, table.position),
    index("knowledge_chunks_source_idx").on(table.sourceId, table.position),
    index("knowledge_chunks_workspace_idx").on(table.workspaceId),
    // The expression must match retrieveKnowledge() exactly or the index is unusable.
    index("knowledge_chunks_content_fts_idx").using("gin", sql`to_tsvector('english', ${table.content})`),
  ],
);
