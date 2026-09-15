import "server-only";

import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";

import { TOKEN_TABLE_LIMIT } from "@/features/analytics/constants";
import { resolveAnalyticsRange } from "@/features/analytics/series";
import {
  USAGE_KINDS,
  type AnalyticsKpis,
  type AnalyticsPeriod,
  type ChannelCount,
  type ChatbotMessagesRow,
  type ConversationChannel,
  type ConversationSeries,
  type CrmGrowth,
  type TokenUsage,
  type UsageKind,
  type UsageTotals,
  type WorkflowRunsSummary,
} from "@/features/analytics/types";
import { query, queryOne, withDb } from "@/server/db/client";
import { chatbots, conversations, messages, usageEvents } from "@/server/db/schema";
import { toIsoRequired } from "@/server/db/sql";

/**
 * Read-only aggregates for the analytics page. One function per section so the
 * page can stream each behind its own Suspense boundary.
 *
 * Every statement filters on the workspace id resolved by
 * `requireWorkspaceAccess` — never one that arrived from the client.
 *
 * ── Why most of this module is still hand-written SQL ───────────────────────
 *
 * This is the densest concentration of PostgreSQL-specific query shapes in the
 * codebase, and each one is a feature Drizzle's builder has no vocabulary for:
 *
 *   - `BUCKET_GRID` is a CTE whose FROM clause is `generate_series` reached
 *     through `CROSS JOIN LATERAL`. The grid is the whole point: it is what
 *     makes an empty bucket come back as a zero instead of disappearing.
 *   - The channel mix drives its outer join from
 *     `unnest(enum_range(NULL::conversation_channel))`, so a channel nobody
 *     used still reports an honest zero. That reads the enum's own definition.
 *   - The usage totals drive theirs from `unnest($3::text[])` for the same
 *     reason.
 *   - The KPI and CRM totals select correlated scalar subqueries over a
 *     one-row `win` CTE, which is again a FROM the builder cannot name.
 *
 * The two queries here that are ordinary joins with a GROUP BY —
 * `getMessagesByChatbot` and the per-chatbot token table — go through Drizzle.
 * The classification is recorded in `docs/drizzle-orm-migration-plan.md`.
 *
 * Time handling: KPI windows are exact rolling windows (`24 hours × n`, so a
 * daylight-saving change cannot lengthen or shorten a period). Time series are
 * bucketed on a `generate_series` grid anchored to UTC midnight (or UTC Monday
 * for weekly buckets), so a bucket with no rows comes back as a zero instead of
 * disappearing, and the previous period lines up index-by-index with the
 * current one.
 */

/**
 * Bucket grid shared by every time series: $2 = bucket count, $3 = bucket width
 * as an interval, $4 = the `date_trunc` field. The arithmetic runs on naive UTC
 * timestamps so a bucket is exactly one day or one week wide whatever the
 * session time zone is; only the comparisons against `created_at` convert back.
 */
const BUCKET_GRID = `
  bounds AS (
    SELECT date_trunc($4::text, (now() AT TIME ZONE 'UTC')) AS anchor,
           $3::interval AS step,
           $2::int      AS buckets
  ),
  grid AS (
    SELECT g.i,
           b.anchor - (b.buckets - 1 - g.i) * b.step     AS cur_start,
           b.anchor - (2 * b.buckets - 1 - g.i) * b.step AS prev_start
    FROM bounds b
    CROSS JOIN LATERAL generate_series(0, b.buckets - 1) AS g(i)
  )`;

interface GridParams {
  days: number;
  bucket: "day" | "week";
  bucketCount: number;
  step: string;
}

function gridParams(period: AnalyticsPeriod): GridParams {
  const range = resolveAnalyticsRange(period);
  return {
    days: range.days,
    bucket: range.bucket,
    bucketCount: range.bucketCount,
    step: range.bucket === "week" ? "7 days" : "1 day",
  };
}

/** Counts and sums arrive as strings (bigint / numeric); every one is narrowed here. */
const n = (value: string | number | null | undefined): number => Number(value ?? 0);

/* -------------------------------------------------------------------------- */
/* KPI row                                                                     */
/* -------------------------------------------------------------------------- */

export async function getAnalyticsKpis(workspaceId: string, period: AnalyticsPeriod): Promise<AnalyticsKpis> {
  const { days } = gridParams(period);
  const row = await queryOne<Record<string, string>>(
    `WITH win AS (
       SELECT now() - ($2::int * interval '24 hours')     AS cur_start,
              now() - (2 * $2::int * interval '24 hours') AS prev_start
     )
     SELECT
       (SELECT count(*) FROM conversations c
         WHERE c.workspace_id = $1 AND c.created_at >= w.cur_start) AS conversations_current,
       (SELECT count(*) FROM conversations c
         WHERE c.workspace_id = $1 AND c.created_at >= w.prev_start AND c.created_at < w.cur_start) AS conversations_previous,
       (SELECT count(*) FROM messages m
         WHERE m.workspace_id = $1 AND m.role = 'user' AND m.created_at >= w.cur_start) AS visitor_messages_current,
       (SELECT count(*) FROM messages m
         WHERE m.workspace_id = $1 AND m.role = 'user' AND m.created_at >= w.prev_start AND m.created_at < w.cur_start) AS visitor_messages_previous,
       (SELECT count(*) FROM conversations c
         WHERE c.workspace_id = $1 AND c.status = 'resolved' AND c.created_at >= w.cur_start) AS resolved_current,
       (SELECT count(*) FROM conversations c
         WHERE c.workspace_id = $1 AND c.status = 'resolved' AND c.created_at >= w.prev_start AND c.created_at < w.cur_start) AS resolved_previous,
       (SELECT coalesce(sum(u.quantity), 0) FROM usage_events u
         WHERE u.workspace_id = $1 AND u.kind IN ('tokens_in', 'tokens_out') AND u.occurred_at >= w.cur_start) AS tokens_current,
       (SELECT coalesce(sum(u.quantity), 0) FROM usage_events u
         WHERE u.workspace_id = $1 AND u.kind IN ('tokens_in', 'tokens_out') AND u.occurred_at >= w.prev_start AND u.occurred_at < w.cur_start) AS tokens_previous,
       (SELECT coalesce(sum(u.quantity), 0) FROM usage_events u
         WHERE u.workspace_id = $1 AND u.kind = 'tokens_in' AND u.occurred_at >= w.cur_start) AS tokens_in,
       (SELECT coalesce(sum(u.quantity), 0) FROM usage_events u
         WHERE u.workspace_id = $1 AND u.kind = 'tokens_out' AND u.occurred_at >= w.cur_start) AS tokens_out
     FROM win w`,
    [workspaceId, days],
  );
  return {
    conversations: { current: n(row?.conversations_current), previous: n(row?.conversations_previous) },
    visitorMessages: { current: n(row?.visitor_messages_current), previous: n(row?.visitor_messages_previous) },
    resolvedConversations: { current: n(row?.resolved_current), previous: n(row?.resolved_previous) },
    tokens: { current: n(row?.tokens_current), previous: n(row?.tokens_previous) },
    tokensIn: n(row?.tokens_in),
    tokensOut: n(row?.tokens_out),
  };
}

/* -------------------------------------------------------------------------- */
/* Conversations over time                                                     */
/* -------------------------------------------------------------------------- */

export async function getConversationSeries(workspaceId: string, period: AnalyticsPeriod): Promise<ConversationSeries> {
  const { bucket, bucketCount, step } = gridParams(period);
  const rows = await query<{ bucket_start: Date; prev_bucket_start: Date; current_count: string; previous_count: string }>(
    `WITH ${BUCKET_GRID},
     counts AS (
       SELECT date_trunc($4::text, (c.created_at AT TIME ZONE 'UTC')) AS bucket_start, count(*) AS n
       FROM conversations c, bounds b
       WHERE c.workspace_id = $1
         AND c.created_at >= ((b.anchor - (2 * b.buckets - 1) * b.step) AT TIME ZONE 'UTC')
         AND c.created_at <  ((b.anchor + b.step) AT TIME ZONE 'UTC')
       GROUP BY 1
     )
     SELECT (g.cur_start AT TIME ZONE 'UTC')  AS bucket_start,
            (g.prev_start AT TIME ZONE 'UTC') AS prev_bucket_start,
            coalesce(cur.n, 0)  AS current_count,
            coalesce(prev.n, 0) AS previous_count
     FROM grid g
     LEFT JOIN counts cur  ON cur.bucket_start  = g.cur_start
     LEFT JOIN counts prev ON prev.bucket_start = g.prev_start
     ORDER BY g.i`,
    [workspaceId, bucketCount, step, bucket],
  );
  return {
    bucket,
    current: rows.map((row) => ({ start: toIsoRequired(row.bucket_start), value: n(row.current_count) })),
    previous: rows.map((row) => ({ start: toIsoRequired(row.prev_bucket_start), value: n(row.previous_count) })),
  };
}

/* -------------------------------------------------------------------------- */
/* Channel mix                                                                 */
/* -------------------------------------------------------------------------- */

export async function getChannelMix(workspaceId: string, period: AnalyticsPeriod): Promise<ChannelCount[]> {
  const { days } = gridParams(period);
  // enum_range gives every channel a row, so a channel nobody used shows as an
  // honest zero rather than vanishing from the mix.
  const rows = await query<{ channel: ConversationChannel; count: string }>(
    `SELECT ch.channel::text AS channel, count(c.id) AS count
     FROM unnest(enum_range(NULL::conversation_channel)) AS ch(channel)
     LEFT JOIN conversations c
       ON c.channel = ch.channel
      AND c.workspace_id = $1
      AND c.created_at >= now() - ($2::int * interval '24 hours')
     GROUP BY ch.channel
     ORDER BY count DESC, ch.channel`,
    [workspaceId, days],
  );
  return rows.map((row) => ({ channel: row.channel, count: n(row.count) }));
}

/* -------------------------------------------------------------------------- */
/* Messages by chatbot                                                         */
/* -------------------------------------------------------------------------- */

export async function getMessagesByChatbot(workspaceId: string, period: AnalyticsPeriod): Promise<ChatbotMessagesRow[]> {
  const { days } = gridParams(period);
  const rows = await withDb((db) =>
    db
      .select({
        chatbotId: conversations.chatbotId,
        name: chatbots.name,
        // `.as()` is required, not decorative: Drizzle emits no AS clause for a
        // select field on its own, and `messages` is also a table in the FROM
        // here - so without the alias, `ORDER BY messages` would silently sort
        // by that table's whole-row composite instead of by this count.
        messages: sql<number>`count(${messages.id})`.mapWith(Number).as("messages"),
      })
      .from(messages)
      // Both joins repeat the workspace predicate, so neither the conversation
      // nor its chatbot name can be borrowed from another tenant.
      .innerJoin(conversations, and(eq(conversations.id, messages.conversationId), eq(conversations.workspaceId, workspaceId)))
      .leftJoin(chatbots, and(eq(chatbots.id, conversations.chatbotId), eq(chatbots.workspaceId, workspaceId)))
      .where(
        and(
          eq(messages.workspaceId, workspaceId),
          inArray(messages.role, ["user", "assistant"]),
          gte(messages.createdAt, sql`now() - (${days}::int * interval '24 hours')`),
        ),
      )
      .groupBy(conversations.chatbotId, chatbots.name)
      .orderBy(sql`messages DESC`, sql`${chatbots.name} NULLS LAST`),
  );
  return rows.map((row) => ({
    chatbotId: row.chatbotId,
    // conversations.chatbot_id is nulled when a chatbot is deleted, so this row
    // also absorbs traffic from bots that no longer exist.
    name: row.name ?? "Without a chatbot",
    messages: row.messages,
  }));
}

/* -------------------------------------------------------------------------- */
/* Token usage                                                                 */
/* -------------------------------------------------------------------------- */

export async function getTokenUsage(workspaceId: string, period: AnalyticsPeriod): Promise<TokenUsage> {
  const { bucket, bucketCount, step, days } = gridParams(period);
  const [series, byChatbot] = await Promise.all([
    query<{ bucket_start: Date; tokens_in: string; tokens_out: string }>(
      `WITH ${BUCKET_GRID},
       totals AS (
         SELECT date_trunc($4::text, (u.occurred_at AT TIME ZONE 'UTC')) AS bucket_start,
                coalesce(sum(u.quantity) FILTER (WHERE u.kind = 'tokens_in'), 0)  AS tokens_in,
                coalesce(sum(u.quantity) FILTER (WHERE u.kind = 'tokens_out'), 0) AS tokens_out
         FROM usage_events u, bounds b
         WHERE u.workspace_id = $1
           AND u.kind IN ('tokens_in', 'tokens_out')
           AND u.occurred_at >= ((b.anchor - (b.buckets - 1) * b.step) AT TIME ZONE 'UTC')
           AND u.occurred_at <  ((b.anchor + b.step) AT TIME ZONE 'UTC')
         GROUP BY 1
       )
       SELECT (g.cur_start AT TIME ZONE 'UTC') AS bucket_start,
              coalesce(t.tokens_in, 0)  AS tokens_in,
              coalesce(t.tokens_out, 0) AS tokens_out
       FROM grid g
       LEFT JOIN totals t ON t.bucket_start = g.cur_start
       ORDER BY g.i`,
      [workspaceId, bucketCount, step, bucket],
    ),
    // Token events carry ref_type / ref_id, and chatbot turns record
    // ref_type = 'chatbot'. Agent and workflow spend is metered under its own
    // ref_type, so this table is explicitly the chatbot slice of the total.
    withDb((db) =>
      db
        .select({
          chatbotId: usageEvents.refId,
          name: chatbots.name,
          tokensIn: sql<number>`coalesce(sum(${usageEvents.quantity}) FILTER (WHERE ${usageEvents.kind} = 'tokens_in'), 0)`.mapWith(Number),
          tokensOut:
            sql<number>`coalesce(sum(${usageEvents.quantity}) FILTER (WHERE ${usageEvents.kind} = 'tokens_out'), 0)`.mapWith(Number),
        })
        .from(usageEvents)
        .leftJoin(chatbots, and(eq(chatbots.id, usageEvents.refId), eq(chatbots.workspaceId, workspaceId)))
        .where(
          and(
            eq(usageEvents.workspaceId, workspaceId),
            eq(usageEvents.refType, "chatbot"),
            isNotNull(usageEvents.refId),
            inArray(usageEvents.kind, ["tokens_in", "tokens_out"]),
            gte(usageEvents.occurredAt, sql`now() - (${days}::int * interval '24 hours')`),
          ),
        )
        .groupBy(usageEvents.refId, chatbots.name)
        .orderBy(sql`sum(${usageEvents.quantity}) DESC`)
        .limit(TOKEN_TABLE_LIMIT),
    ),
  ]);

  const mapped = series.map((row) => ({
    start: toIsoRequired(row.bucket_start),
    tokensIn: n(row.tokens_in),
    tokensOut: n(row.tokens_out),
  }));
  return {
    bucket,
    series: mapped,
    byChatbot: byChatbot.map((row) => ({
      chatbotId: row.chatbotId as string,
      name: row.name,
      tokensIn: row.tokensIn,
      tokensOut: row.tokensOut,
    })),
    totalIn: mapped.reduce((sum, row) => sum + row.tokensIn, 0),
    totalOut: mapped.reduce((sum, row) => sum + row.tokensOut, 0),
  };
}

/* -------------------------------------------------------------------------- */
/* Workflow run outcomes                                                       */
/* -------------------------------------------------------------------------- */

export async function getWorkflowRunsSummary(workspaceId: string, period: AnalyticsPeriod): Promise<WorkflowRunsSummary> {
  const { days } = gridParams(period);
  // The join restricts rows to both periods, so the FILTERs only need to say
  // which side of cur_start a run falls on. A workspace with no runs still
  // yields one all-zero row because the aggregate has no GROUP BY.
  const row = await queryOne<Record<string, string>>(
    `WITH win AS (
       SELECT now() - ($2::int * interval '24 hours')     AS cur_start,
              now() - (2 * $2::int * interval '24 hours') AS prev_start
     )
     SELECT
       count(r.id) FILTER (WHERE r.created_at >= w.cur_start)                            AS total,
       count(r.id) FILTER (WHERE r.created_at >= w.cur_start AND r.status = 'succeeded') AS succeeded,
       count(r.id) FILTER (WHERE r.created_at >= w.cur_start AND r.status = 'failed')    AS failed,
       count(r.id) FILTER (WHERE r.created_at < w.cur_start)                             AS previous_total,
       count(r.id) FILTER (WHERE r.created_at < w.cur_start AND r.status = 'succeeded')  AS previous_succeeded,
       count(r.id) FILTER (WHERE r.created_at < w.cur_start AND r.status = 'failed')     AS previous_failed
     FROM win w
     LEFT JOIN workflow_runs r
       ON r.workspace_id = $1
      AND r.created_at >= w.prev_start`,
    [workspaceId, days],
  );
  return {
    total: n(row?.total),
    succeeded: n(row?.succeeded),
    failed: n(row?.failed),
    previousTotal: n(row?.previous_total),
    previousSucceeded: n(row?.previous_succeeded),
    previousFailed: n(row?.previous_failed),
  };
}

/* -------------------------------------------------------------------------- */
/* CRM growth                                                                  */
/* -------------------------------------------------------------------------- */

export async function getCrmGrowth(workspaceId: string, period: AnalyticsPeriod): Promise<CrmGrowth> {
  const { bucket, bucketCount, step, days } = gridParams(period);
  const [totals, rows] = await Promise.all([
    queryOne<Record<string, string>>(
      `WITH win AS (
         SELECT now() - ($2::int * interval '24 hours')     AS cur_start,
                now() - (2 * $2::int * interval '24 hours') AS prev_start
       )
       SELECT
         (SELECT count(*) FROM contacts c WHERE c.workspace_id = $1) AS total_contacts,
         (SELECT count(*) FROM contacts c WHERE c.workspace_id = $1 AND c.created_at >= w.cur_start) AS new_contacts,
         (SELECT count(*) FROM contacts c WHERE c.workspace_id = $1 AND c.created_at >= w.prev_start AND c.created_at < w.cur_start) AS previous_new_contacts
       FROM win w`,
      [workspaceId, days],
    ),
    query<{ bucket_start: Date; count: string }>(
      `WITH ${BUCKET_GRID},
       counts AS (
         SELECT date_trunc($4::text, (c.created_at AT TIME ZONE 'UTC')) AS bucket_start, count(*) AS n
         FROM contacts c, bounds b
         WHERE c.workspace_id = $1
           AND c.created_at >= ((b.anchor - (b.buckets - 1) * b.step) AT TIME ZONE 'UTC')
           AND c.created_at <  ((b.anchor + b.step) AT TIME ZONE 'UTC')
         GROUP BY 1
       )
       SELECT (g.cur_start AT TIME ZONE 'UTC') AS bucket_start, coalesce(c.n, 0) AS count
       FROM grid g
       LEFT JOIN counts c ON c.bucket_start = g.cur_start
       ORDER BY g.i`,
      [workspaceId, bucketCount, step, bucket],
    ),
  ]);
  return {
    totalContacts: n(totals?.total_contacts),
    newContacts: n(totals?.new_contacts),
    previousNewContacts: n(totals?.previous_new_contacts),
    bucket,
    series: rows.map((row) => ({ start: toIsoRequired(row.bucket_start), value: n(row.count) })),
  };
}

/* -------------------------------------------------------------------------- */
/* Usage totals                                                                */
/* -------------------------------------------------------------------------- */

export async function getUsageTotals(workspaceId: string, period: AnalyticsPeriod): Promise<UsageTotals> {
  const { days } = gridParams(period);
  // The kind list drives the join, so every metered kind returns a row even
  // when the workspace has never produced that event.
  const rows = await query<{ kind: UsageKind; total: string }>(
    `SELECT k.kind, coalesce(sum(u.quantity), 0) AS total
     FROM unnest($3::text[]) AS k(kind)
     LEFT JOIN usage_events u
       ON u.workspace_id = $1
      AND u.kind = k.kind
      AND u.occurred_at >= now() - ($2::int * interval '24 hours')
     GROUP BY k.kind`,
    [workspaceId, days, [...USAGE_KINDS]],
  );
  const totals = Object.fromEntries(USAGE_KINDS.map((kind) => [kind, 0])) as UsageTotals;
  for (const row of rows) {
    if ((USAGE_KINDS as readonly string[]).includes(row.kind)) totals[row.kind] = n(row.total);
  }
  return totals;
}
