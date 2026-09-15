import { sql } from "drizzle-orm";
import { boolean, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { analysisRunStatus, conversationOutcome } from "@/server/db/schema/columns";
import { conversations } from "@/server/db/schema/conversations";
import { users } from "@/server/db/schema/identity";
import { workspaces } from "@/server/db/schema/tenancy";

/**
 * The derived layer over `conversations` (migration 0027).
 *
 * Every column here is recomputable from conversations and messages. Nothing
 * in this file is a source of truth, which is why the analysis is free to
 * overwrite any of it on the next run.
 */

export const conversationTopics = pgTable(
  "conversation_topics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    summary: text("summary"),
    /** Running mean of member question vectors, L2-normalized on write. */
    centroid: doublePrecision("centroid").array().notNull(),
    /**
     * How the centroid was produced. A centroid is only comparable to vectors
     * from the same model and dimension count, and mixing two spaces fails
     * silently rather than loudly, so the config travels with the vector.
     */
    embeddingConfig: jsonb("embedding_config").notNull().default({}),
    conversationCount: integer("conversation_count").notNull().default(0),
    containedCount: integer("contained_count").notNull().default(0),
    groundedCount: integer("grounded_count").notNull().default(0),
    escalatedCount: integer("escalated_count").notNull().default(0),
    labeledAt: timestamp("labeled_at", { withTimezone: true }),
    /** conversation_count when the label was written; drives relabelling. */
    labeledSize: integer("labeled_size").notNull().default(0),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("conversation_topics_workspace_size_idx").on(table.workspaceId, table.conversationCount.desc(), table.id.desc()),
    index("conversation_topics_workspace_seen_idx").on(table.workspaceId, table.lastSeenAt.desc().nullsLast()),
  ],
);

export const conversationInsights = pgTable(
  "conversation_insights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    topicId: uuid("topic_id").references(() => conversationTopics.id, { onDelete: "set null" }),
    question: text("question").notNull(),
    embedding: doublePrecision("embedding").array(),
    outcome: conversationOutcome("outcome").notNull(),
    grounded: boolean("grounded").notNull().default(false),
    userMessageCount: integer("user_message_count").notNull().default(0),
    sourceCount: integer("source_count").notNull().default(0),
    topicSimilarity: doublePrecision("topic_similarity"),
    /** When the conversation happened. Distinct from when it was analyzed. */
    conversationAt: timestamp("conversation_at", { withTimezone: true }).notNull(),
    analyzedAt: timestamp("analyzed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The upsert key: one insight per conversation, so a re-run overwrites
    // rather than duplicating.
    uniqueIndex("conversation_insights_conversation_idx").on(table.conversationId),
    index("conversation_insights_workspace_analyzed_idx").on(table.workspaceId, table.analyzedAt.desc()),
    index("conversation_insights_topic_idx").on(table.topicId, table.conversationAt.desc()),
    index("conversation_insights_workspace_gap_idx")
      .on(table.workspaceId, table.analyzedAt.desc())
      .where(sql`${table.grounded} = false`),
  ],
);

export const conversationAnalysisRuns = pgTable(
  "conversation_analysis_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    status: analysisRunStatus("status").notNull().default("running"),
    windowStart: timestamp("window_start", { withTimezone: true }),
    windowEnd: timestamp("window_end", { withTimezone: true }),
    conversationsAnalyzed: integer("conversations_analyzed").notNull().default(0),
    topicsCreated: integer("topics_created").notNull().default(0),
    topicsLabeled: integer("topics_labeled").notNull().default(0),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    error: text("error"),
    startedBy: uuid("started_by").references(() => users.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("conversation_analysis_runs_workspace_started_idx").on(table.workspaceId, table.startedAt.desc()),
    // One run in flight per workspace. The database owns this, not the service:
    // a check-then-insert races with itself.
    uniqueIndex("conversation_analysis_runs_one_active_idx")
      .on(table.workspaceId)
      .where(sql`${table.status} = 'running'`),
  ],
);
