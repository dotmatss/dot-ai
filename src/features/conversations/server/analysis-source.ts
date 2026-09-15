import "server-only";

import type { ConversationChannel, ConversationStatus } from "@/features/conversations/types";
import { query } from "@/server/db/client";
import { toIso, toIsoRequired } from "@/server/db/sql";

/**
 * Read model for Conversation Intelligence.
 *
 * It lives here because it is conversation data. The intelligence feature
 * consumes it rather than writing its own query over `conversations` and
 * `messages`, so what counts as a "grounded answer" or a "human reply" stays
 * owned in one place - the same rule `embed-deployments.ts` follows for the
 * developer area.
 *
 * WHY THIS IS HAND-WRITTEN SQL
 * ----------------------------
 * The whole point is one pass over a thread's messages producing four facts at
 * once: the opening question, how many turns the person took, whether any reply
 * cited knowledge, and whether a human answered. That is `FILTER` aggregates, a
 * correlated `LIMIT 1`, and a `jsonb_typeof` guard inside a LATERAL - the query
 * *is* the logic, with nothing incidental left for a builder to hold. Recorded
 * as a classified exception in `docs/drizzle-orm-migration-plan.md`.
 */

/** A conversation reduced to the signals the analysis actually reads. */
export interface ConversationAnalysisRow {
  conversationId: string;
  status: ConversationStatus;
  channel: ConversationChannel;
  title: string | null;
  /** First user message in the thread, trimmed. Never empty. */
  question: string;
  userMessageCount: number;
  /**
   * Total knowledge citations across every assistant reply. Zero means the
   * assistant answered this thread from the model's own weights.
   */
  sourceCount: number;
  /** Replies written by a team member from the inbox. */
  humanReplyCount: number;
  createdAt: string;
  lastMessageAt: string | null;
}

interface AnalysisSqlRow {
  conversation_id: string;
  status: ConversationStatus;
  channel: ConversationChannel;
  title: string | null;
  question: string;
  user_message_count: string | number;
  source_count: string | number;
  human_reply_count: string | number;
  created_at: Date;
  last_message_at: Date | null;
}

const n = (value: string | number | null): number => (value === null ? 0 : Number(value));

export interface AnalysisSourceOptions {
  /** Only conversations created at or after this instant. */
  since: Date;
  /** Hard cap, so one run over a busy workspace stays bounded. */
  limit: number;
}

/**
 * Conversations in the window, oldest first, with their derived signals.
 *
 * Oldest first is deliberate: topics are built incrementally by assigning each
 * conversation to the nearest existing centroid, so processing in chronological
 * order means a topic is founded by the first question that raised it rather
 * than by whichever row the database happened to return first.
 *
 * A thread with no user message is skipped entirely. There is nothing to
 * cluster on, and an empty question would embed to the zero vector and land in
 * whatever topic it was compared against first.
 */
export async function listConversationsForAnalysis(
  workspaceId: string,
  options: AnalysisSourceOptions,
): Promise<ConversationAnalysisRow[]> {
  const rows = await query<AnalysisSqlRow>(
    `SELECT c.id                         AS conversation_id,
            c.status,
            c.channel,
            c.title,
            btrim(m.first_question)      AS question,
            m.user_message_count,
            m.source_count,
            m.human_reply_count,
            c.created_at,
            c.last_message_at
       FROM conversations c
       JOIN LATERAL (
         SELECT
           (SELECT content
              FROM messages
             WHERE conversation_id = c.id
               AND workspace_id = c.workspace_id
               AND role = 'user'
             ORDER BY created_at, id
             LIMIT 1) AS first_question,
           count(*) FILTER (WHERE role = 'user') AS user_message_count,
           -- The sources column is nullable and free-form jsonb, and
           -- jsonb_array_length raises on a non-array, so the type is checked
           -- before it is read rather than trusting every writer to have
           -- stored a list.
           coalesce(sum(
             CASE WHEN jsonb_typeof(sources) = 'array' THEN jsonb_array_length(sources) ELSE 0 END
           ), 0) AS source_count,
           count(*) FILTER (WHERE author_id IS NOT NULL) AS human_reply_count
         FROM messages
        WHERE conversation_id = c.id
          AND workspace_id = c.workspace_id
       ) m ON true
      WHERE c.workspace_id = $1
        AND c.created_at >= $2
        AND m.first_question IS NOT NULL
        AND btrim(m.first_question) <> ''
      ORDER BY c.created_at, c.id
      LIMIT $3`,
    [workspaceId, options.since, options.limit],
  );

  return rows.map((row) => ({
    conversationId: row.conversation_id,
    status: row.status,
    channel: row.channel,
    title: row.title,
    question: row.question,
    userMessageCount: n(row.user_message_count),
    sourceCount: n(row.source_count),
    humanReplyCount: n(row.human_reply_count),
    createdAt: toIsoRequired(row.created_at),
    lastMessageAt: toIso(row.last_message_at),
  }));
}

/** A conversation as the intelligence UI lists it, without the transcript. */
export interface ConversationBrief {
  id: string;
  title: string | null;
  status: ConversationStatus;
  channel: ConversationChannel;
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
}

interface BriefSqlRow {
  id: string;
  title: string | null;
  status: ConversationStatus;
  channel: ConversationChannel;
  message_count: number;
  last_message_at: Date | null;
  created_at: Date;
}

/**
 * Hydrates conversation ids the intelligence feature already holds.
 *
 * The workspace filter is not redundant with the id list: the ids come from
 * `conversation_insights`, and a row there is only ever as trustworthy as the
 * query that produced it. Tenancy is re-asserted at every read, not inherited.
 */
export async function listConversationBriefs(workspaceId: string, ids: string[]): Promise<ConversationBrief[]> {
  const unique = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
  if (unique.length === 0) return [];

  const rows = await query<BriefSqlRow>(
    `SELECT id, title, status, channel, message_count, last_message_at, created_at
       FROM conversations
      WHERE workspace_id = $1
        AND id = ANY($2::uuid[])
      ORDER BY last_message_at DESC NULLS LAST, id DESC`,
    [workspaceId, unique],
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    channel: row.channel,
    messageCount: row.message_count,
    lastMessageAt: toIso(row.last_message_at),
    createdAt: toIsoRequired(row.created_at),
  }));
}
