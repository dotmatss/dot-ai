import "server-only";

import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";

import {
  KNOWLEDGE_GAP_COVERAGE_THRESHOLD,
  KNOWLEDGE_GAP_MIN_CONVERSATIONS,
} from "@/features/intelligence/constants";
import type {
  AnalysisRun,
  AnalysisRunStatus,
  ConversationInsight,
  ConversationOutcome,
  IntelligenceOverview,
  Topic,
  TopicListFilters,
  TopicSummary,
} from "@/features/intelligence/types";
import { withDb, type DatabaseClient } from "@/server/db/client";
import { conversationAnalysisRuns, conversationInsights, conversationTopics } from "@/server/db/schema";
import { likePattern, normalizePage, toIso, toIsoRequired, toPaginated } from "@/server/db/sql";
import type { Paginated } from "@/types/pagination";

/**
 * All Conversation Intelligence persistence.
 *
 * Every statement filters on `workspace_id` explicitly. RLS is the second line
 * of defence behind these predicates, never the first - see
 * `src/server/db/schema/index.ts`.
 *
 * This repository owns `conversation_topics`, `conversation_insights` and
 * `conversation_analysis_runs` and nothing else. Conversation and message rows
 * reach it through `listConversationsForAnalysis`, a read model the
 * conversations feature exports, so the rules about what a grounded answer is
 * stay owned there.
 */

/* -------------------------------------------------------------------------- */
/* Row shapes and mappers                                                      */
/* -------------------------------------------------------------------------- */

interface TopicRow {
  id: string;
  workspaceId: string;
  label: string;
  summary: string | null;
  conversationCount: number;
  containedCount: number;
  groundedCount: number;
  escalatedCount: number;
  labeledAt: Date | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  updatedAt: Date;
}

const topicColumns = {
  id: conversationTopics.id,
  workspaceId: conversationTopics.workspaceId,
  label: conversationTopics.label,
  summary: conversationTopics.summary,
  conversationCount: conversationTopics.conversationCount,
  containedCount: conversationTopics.containedCount,
  groundedCount: conversationTopics.groundedCount,
  escalatedCount: conversationTopics.escalatedCount,
  labeledAt: conversationTopics.labeledAt,
  firstSeenAt: conversationTopics.firstSeenAt,
  lastSeenAt: conversationTopics.lastSeenAt,
  updatedAt: conversationTopics.updatedAt,
};

function mapTopicSummary(row: TopicRow): TopicSummary {
  return {
    id: row.id,
    label: row.label,
    summary: row.summary,
    conversationCount: row.conversationCount,
    containedCount: row.containedCount,
    groundedCount: row.groundedCount,
    escalatedCount: row.escalatedCount,
    labeledAt: toIso(row.labeledAt),
    firstSeenAt: toIso(row.firstSeenAt),
    lastSeenAt: toIso(row.lastSeenAt),
    updatedAt: toIsoRequired(row.updatedAt),
  };
}

interface InsightRow {
  id: string;
  conversationId: string;
  topicId: string | null;
  question: string;
  outcome: ConversationOutcome;
  grounded: boolean;
  userMessageCount: number;
  sourceCount: number;
  topicSimilarity: number | null;
  conversationAt: Date;
  analyzedAt: Date;
}

const insightColumns = {
  id: conversationInsights.id,
  conversationId: conversationInsights.conversationId,
  topicId: conversationInsights.topicId,
  question: conversationInsights.question,
  outcome: conversationInsights.outcome,
  grounded: conversationInsights.grounded,
  userMessageCount: conversationInsights.userMessageCount,
  sourceCount: conversationInsights.sourceCount,
  topicSimilarity: conversationInsights.topicSimilarity,
  conversationAt: conversationInsights.conversationAt,
  analyzedAt: conversationInsights.analyzedAt,
};

function mapInsight(row: InsightRow): ConversationInsight {
  return {
    id: row.id,
    conversationId: row.conversationId,
    topicId: row.topicId,
    question: row.question,
    outcome: row.outcome,
    grounded: row.grounded,
    userMessageCount: row.userMessageCount,
    sourceCount: row.sourceCount,
    topicSimilarity: row.topicSimilarity === null ? null : Number(row.topicSimilarity),
    conversationAt: toIsoRequired(row.conversationAt),
    analyzedAt: toIsoRequired(row.analyzedAt),
  };
}

interface RunRow {
  id: string;
  status: AnalysisRunStatus;
  windowStart: Date | null;
  windowEnd: Date | null;
  conversationsAnalyzed: number;
  topicsCreated: number;
  topicsLabeled: number;
  tokensIn: number;
  tokensOut: number;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

const runColumns = {
  id: conversationAnalysisRuns.id,
  status: conversationAnalysisRuns.status,
  windowStart: conversationAnalysisRuns.windowStart,
  windowEnd: conversationAnalysisRuns.windowEnd,
  conversationsAnalyzed: conversationAnalysisRuns.conversationsAnalyzed,
  topicsCreated: conversationAnalysisRuns.topicsCreated,
  topicsLabeled: conversationAnalysisRuns.topicsLabeled,
  tokensIn: conversationAnalysisRuns.tokensIn,
  tokensOut: conversationAnalysisRuns.tokensOut,
  error: conversationAnalysisRuns.error,
  startedAt: conversationAnalysisRuns.startedAt,
  finishedAt: conversationAnalysisRuns.finishedAt,
};

function mapRun(row: RunRow): AnalysisRun {
  return {
    id: row.id,
    status: row.status,
    windowStart: toIso(row.windowStart),
    windowEnd: toIso(row.windowEnd),
    conversationsAnalyzed: row.conversationsAnalyzed,
    topicsCreated: row.topicsCreated,
    topicsLabeled: row.topicsLabeled,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    error: row.error,
    startedAt: toIsoRequired(row.startedAt),
    finishedAt: toIso(row.finishedAt),
  };
}

/* -------------------------------------------------------------------------- */
/* Topics                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The gap score, in SQL.
 *
 * `count * (1 - grounded/count)` reduces exactly to `count - grounded`, so this
 * is `knowledgeGapScore()` from `metrics.ts` written the only other way it can
 * be written. The two are the same expression, not two definitions that have to
 * be kept in step - which is the point of reducing it rather than transcribing
 * the ratio into SQL and hoping nobody edits one side.
 */
const gapScoreSql = sql`(${conversationTopics.conversationCount} - ${conversationTopics.groundedCount})`;

/**
 * `grounded <= count * threshold`, as a predicate over the stored counters.
 *
 * The casts are load-bearing. Both counters are `integer`, so PostgreSQL infers
 * the type of an untyped parameter next to them as `integer` too - and the
 * threshold is 0.5, which fails to parse as one. The error is a runtime 22P02
 * on a query that type-checks perfectly, so the cast is written out rather than
 * left to inference.
 */
const isGapSql = and(
  sql`${conversationTopics.conversationCount} >= ${KNOWLEDGE_GAP_MIN_CONVERSATIONS}`,
  sql`${conversationTopics.groundedCount}::double precision
      <= ${conversationTopics.conversationCount}::double precision * ${KNOWLEDGE_GAP_COVERAGE_THRESHOLD}::double precision`,
);

export async function listTopics(workspaceId: string, filters: TopicListFilters): Promise<Paginated<TopicSummary>> {
  const page = normalizePage(filters);

  const conditions: Array<SQL | undefined> = [eq(conversationTopics.workspaceId, workspaceId)];
  if (filters.search) {
    const pattern = likePattern(filters.search);
    conditions.push(or(ilike(conversationTopics.label, pattern), ilike(conversationTopics.summary, pattern)));
  }
  if (filters.gapsOnly) conditions.push(isGapSql);
  // Built once and reused by both statements, so the page and its total cannot
  // describe different sets.
  const where = and(...conditions);

  const order =
    filters.sort === "gap"
      ? [desc(gapScoreSql), desc(conversationTopics.id)]
      : filters.sort === "recent"
        ? [desc(conversationTopics.lastSeenAt), desc(conversationTopics.id)]
        : [desc(conversationTopics.conversationCount), desc(conversationTopics.id)];

  const [rows, totals] = await Promise.all([
    withDb((db) =>
      db.select(topicColumns).from(conversationTopics).where(where).orderBy(...order).limit(page.pageSize).offset(page.offset),
    ),
    withDb((db) => db.select({ total: count() }).from(conversationTopics).where(where)),
  ]);

  return toPaginated(rows.map(mapTopicSummary), totals[0]?.total ?? 0, page);
}

export async function findTopicById(
  workspaceId: string,
  topicId: string,
  client?: DatabaseClient,
): Promise<TopicSummary | null> {
  const rows = await withDb(
    (db) =>
      db
        .select(topicColumns)
        .from(conversationTopics)
        .where(and(eq(conversationTopics.workspaceId, workspaceId), eq(conversationTopics.id, topicId)))
        .limit(1),
    client,
  );
  return rows[0] ? mapTopicSummary(rows[0]) : null;
}

/**
 * Representative questions for a topic, most recent first.
 *
 * Recency rather than similarity to the centroid: the point of the examples is
 * to show what people are asking now, and the closest-to-centroid questions are
 * by construction the ones that founded the topic months ago.
 */
export async function listTopicQuestions(
  workspaceId: string,
  topicId: string,
  limit: number,
  client?: DatabaseClient,
): Promise<string[]> {
  const rows = await withDb(
    (db) =>
      db
        .select({ question: conversationInsights.question })
        .from(conversationInsights)
        .where(and(eq(conversationInsights.workspaceId, workspaceId), eq(conversationInsights.topicId, topicId)))
        .orderBy(desc(conversationInsights.conversationAt))
        .limit(limit),
    client,
  );
  return rows.map((row) => row.question);
}

export async function findTopicWithExamples(
  workspaceId: string,
  topicId: string,
  exampleLimit: number,
): Promise<Topic | null> {
  const summary = await findTopicById(workspaceId, topicId);
  if (!summary) return null;
  const examples = await listTopicQuestions(workspaceId, topicId, exampleLimit);
  return { ...summary, workspaceId, examples };
}

export interface TopicCentroidRow {
  id: string;
  centroid: number[];
  size: number;
  embeddingConfig: Record<string, unknown>;
}

/**
 * Every topic's centroid, for the clustering pass.
 *
 * Ordered by id so a run is deterministic: cluster indices are positional, and
 * an unordered read would make "the first cluster that tied" depend on whatever
 * the planner returned.
 */
export async function listTopicCentroids(workspaceId: string, client?: DatabaseClient): Promise<TopicCentroidRow[]> {
  const rows = await withDb(
    (db) =>
      db
        .select({
          id: conversationTopics.id,
          centroid: conversationTopics.centroid,
          size: conversationTopics.conversationCount,
          embeddingConfig: conversationTopics.embeddingConfig,
        })
        .from(conversationTopics)
        .where(eq(conversationTopics.workspaceId, workspaceId))
        .orderBy(asc(conversationTopics.id)),
    client,
  );
  return rows.map((row) => ({
    id: row.id,
    centroid: row.centroid ?? [],
    size: row.size,
    embeddingConfig: (row.embeddingConfig as Record<string, unknown> | null) ?? {},
  }));
}

export interface InsertTopicInput {
  workspaceId: string;
  label: string;
  centroid: number[];
  embeddingConfig: Record<string, unknown>;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export async function insertTopic(input: InsertTopicInput, client?: DatabaseClient): Promise<string> {
  const rows = await withDb(
    (db) =>
      db
        .insert(conversationTopics)
        .values({
          workspaceId: input.workspaceId,
          label: input.label,
          centroid: input.centroid,
          embeddingConfig: input.embeddingConfig,
          firstSeenAt: input.firstSeenAt,
          lastSeenAt: input.lastSeenAt,
        })
        .returning({ id: conversationTopics.id }),
    client,
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("Topic insert returned no id");
  return id;
}

export async function updateTopicCentroid(
  workspaceId: string,
  topicId: string,
  centroid: number[],
  lastSeenAt: Date,
  client?: DatabaseClient,
): Promise<void> {
  await withDb(
    (db) =>
      db
        .update(conversationTopics)
        .set({ centroid, lastSeenAt, updatedAt: new Date() })
        .where(and(eq(conversationTopics.workspaceId, workspaceId), eq(conversationTopics.id, topicId))),
    client,
  );
}

export interface TopicLabelPatch {
  label?: string;
  summary?: string | null;
  labeledAt?: Date;
  labeledSize?: number;
}

export async function updateTopicRow(
  workspaceId: string,
  topicId: string,
  patch: TopicLabelPatch,
  client?: DatabaseClient,
): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  await withDb(
    (db) =>
      db
        .update(conversationTopics)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(conversationTopics.workspaceId, workspaceId), eq(conversationTopics.id, topicId))),
    client,
  );
}

/** Topics that have grown enough since their last label to be worth renaming. */
export interface RelabelCandidate {
  id: string;
  label: string;
  conversationCount: number;
}

export async function listRelabelCandidates(
  workspaceId: string,
  growthFactor: number,
  limit: number,
  client?: DatabaseClient,
): Promise<RelabelCandidate[]> {
  const rows = await withDb(
    (db) =>
      db
        .select({
          id: conversationTopics.id,
          label: conversationTopics.label,
          conversationCount: conversationTopics.conversationCount,
        })
        .from(conversationTopics)
        .where(
          and(
            eq(conversationTopics.workspaceId, workspaceId),
            sql`${conversationTopics.conversationCount} > 0`,
            or(
              // Never labelled at all.
              isNull(conversationTopics.labeledAt),
              // Or grown past the factor since it was. Cast for the same
              // reason as `isGapSql`: a non-integer factor would otherwise be
              // inferred as `integer` from the column beside it.
              sql`${conversationTopics.conversationCount}::double precision
                  >= greatest(${conversationTopics.labeledSize}, 1)::double precision * ${growthFactor}::double precision`,
            ),
          ),
        )
        // Unlabelled first, then biggest: a topic with no name at all is worth
        // more to a reader than a better name on a topic that already has one.
        .orderBy(asc(conversationTopics.labeledAt), desc(conversationTopics.conversationCount))
        .limit(limit),
    client,
  );
  return rows;
}

/** Topics with no conversations left after a rebuild, so the list stays clean. */
export async function deleteEmptyTopics(workspaceId: string, client?: DatabaseClient): Promise<number> {
  const rows = await withDb(
    (db) =>
      db
        .delete(conversationTopics)
        .where(and(eq(conversationTopics.workspaceId, workspaceId), eq(conversationTopics.conversationCount, 0)))
        .returning({ id: conversationTopics.id }),
    client,
  );
  return rows.length;
}

/* -------------------------------------------------------------------------- */
/* Insights                                                                    */
/* -------------------------------------------------------------------------- */

export interface UpsertInsightInput {
  workspaceId: string;
  conversationId: string;
  topicId: string | null;
  question: string;
  embedding: number[] | null;
  outcome: ConversationOutcome;
  grounded: boolean;
  userMessageCount: number;
  sourceCount: number;
  topicSimilarity: number | null;
  conversationAt: Date;
  analyzedAt: Date;
}

/**
 * Writes one conversation's signals.
 *
 * Upsert on `conversation_id`, which is what makes a re-run idempotent: the
 * same window analyzed twice updates the same rows instead of doubling every
 * count. `workspace_id` is deliberately NOT in the update set - a row cannot
 * change tenant, and leaving it out means a bug that passed the wrong workspace
 * fails the conflict rather than quietly rewriting someone else's row.
 */
export async function upsertInsights(inputs: UpsertInsightInput[], client?: DatabaseClient): Promise<void> {
  if (inputs.length === 0) return;
  await withDb(
    (db) =>
      db
        .insert(conversationInsights)
        .values(inputs)
        .onConflictDoUpdate({
          target: conversationInsights.conversationId,
          set: {
            topicId: sql`excluded.topic_id`,
            question: sql`excluded.question`,
            embedding: sql`excluded.embedding`,
            outcome: sql`excluded.outcome`,
            grounded: sql`excluded.grounded`,
            userMessageCount: sql`excluded.user_message_count`,
            sourceCount: sql`excluded.source_count`,
            topicSimilarity: sql`excluded.topic_similarity`,
            conversationAt: sql`excluded.conversation_at`,
            analyzedAt: sql`excluded.analyzed_at`,
            updatedAt: new Date(),
          },
          setWhere: eq(conversationInsights.workspaceId, inputs[0]!.workspaceId),
        }),
    client,
  );
}

export async function listTopicInsights(
  workspaceId: string,
  topicId: string,
  page: { page: number; pageSize: number },
): Promise<Paginated<ConversationInsight>> {
  const normalized = normalizePage(page);
  const where = and(eq(conversationInsights.workspaceId, workspaceId), eq(conversationInsights.topicId, topicId));

  const [rows, totals] = await Promise.all([
    withDb((db) =>
      db
        .select(insightColumns)
        .from(conversationInsights)
        .where(where)
        .orderBy(desc(conversationInsights.conversationAt), desc(conversationInsights.id))
        .limit(normalized.pageSize)
        .offset(normalized.offset),
    ),
    withDb((db) => db.select({ total: count() }).from(conversationInsights).where(where)),
  ]);

  return toPaginated(rows.map(mapInsight), totals[0]?.total ?? 0, normalized);
}

/**
 * Rebuilds every topic counter from the insights that reference it.
 *
 * Recomputed wholesale rather than incremented while the run walks
 * conversations. Incrementing is faster and wrong in the way that matters: a
 * run that fails halfway leaves counters that no longer describe any set of
 * rows, and nothing afterwards can tell that they are skewed. A full recompute
 * is O(insights) once per run and is self-healing.
 */
export async function recomputeTopicCounters(workspaceId: string, client?: DatabaseClient): Promise<void> {
  await withDb(
    (db) =>
      db.execute(sql`
        UPDATE conversation_topics t
           SET conversation_count = coalesce(s.total, 0),
               contained_count    = coalesce(s.contained, 0),
               grounded_count     = coalesce(s.grounded, 0),
               escalated_count    = coalesce(s.escalated, 0),
               first_seen_at      = s.first_seen,
               last_seen_at       = s.last_seen,
               updated_at         = now()
          FROM (
            SELECT tt.id,
                   count(i.id)                                              AS total,
                   count(i.id) FILTER (WHERE i.outcome = 'contained')        AS contained,
                   count(i.id) FILTER (WHERE i.grounded)                     AS grounded,
                   count(i.id) FILTER (WHERE i.outcome = 'escalated')        AS escalated,
                   min(i.conversation_at)                                    AS first_seen,
                   max(i.conversation_at)                                    AS last_seen
              FROM conversation_topics tt
              LEFT JOIN conversation_insights i
                     ON i.topic_id = tt.id
                    AND i.workspace_id = tt.workspace_id
             WHERE tt.workspace_id = ${workspaceId}
             GROUP BY tt.id
          ) s
         WHERE t.id = s.id
           AND t.workspace_id = ${workspaceId}
      `),
    client,
  );
}

/* -------------------------------------------------------------------------- */
/* Overview                                                                    */
/* -------------------------------------------------------------------------- */

export async function getOverview(workspaceId: string): Promise<IntelligenceOverview> {
  const [insightTotals, topicTotals] = await Promise.all([
    withDb((db) =>
      db
        .select({
          analyzed: count(),
          contained: sql<number>`count(*) FILTER (WHERE ${conversationInsights.outcome} = 'contained')`.mapWith(Number),
          handedOff: sql<number>`count(*) FILTER (WHERE ${conversationInsights.outcome} = 'handed_off')`.mapWith(Number),
          escalated: sql<number>`count(*) FILTER (WHERE ${conversationInsights.outcome} = 'escalated')`.mapWith(Number),
          grounded: sql<number>`count(*) FILTER (WHERE ${conversationInsights.grounded})`.mapWith(Number),
          windowStart: sql<Date | null>`min(${conversationInsights.conversationAt})`,
          windowEnd: sql<Date | null>`max(${conversationInsights.conversationAt})`,
        })
        .from(conversationInsights)
        .where(eq(conversationInsights.workspaceId, workspaceId)),
    ),
    withDb((db) =>
      db
        .select({
          topics: count(),
          gaps: sql<number>`count(*) FILTER (WHERE ${isGapSql})`.mapWith(Number),
        })
        .from(conversationTopics)
        .where(eq(conversationTopics.workspaceId, workspaceId)),
    ),
  ]);

  const insight = insightTotals[0];
  const topic = topicTotals[0];

  return {
    conversationsAnalyzed: insight?.analyzed ?? 0,
    topicCount: topic?.topics ?? 0,
    containedCount: insight?.contained ?? 0,
    groundedCount: insight?.grounded ?? 0,
    escalatedCount: insight?.escalated ?? 0,
    handedOffCount: insight?.handedOff ?? 0,
    gapTopicCount: topic?.gaps ?? 0,
    windowStart: toIso(insight?.windowStart ?? null),
    windowEnd: toIso(insight?.windowEnd ?? null),
  };
}

/* -------------------------------------------------------------------------- */
/* Runs                                                                        */
/* -------------------------------------------------------------------------- */

export async function insertRun(
  input: { workspaceId: string; windowStart: Date; windowEnd: Date; startedBy: string | null },
  client?: DatabaseClient,
): Promise<string> {
  const rows = await withDb(
    (db) =>
      db
        .insert(conversationAnalysisRuns)
        .values({
          workspaceId: input.workspaceId,
          status: "running",
          windowStart: input.windowStart,
          windowEnd: input.windowEnd,
          startedBy: input.startedBy,
        })
        .returning({ id: conversationAnalysisRuns.id }),
    client,
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("Analysis run insert returned no id");
  return id;
}

export interface FinishRunInput {
  status: Exclude<AnalysisRunStatus, "running">;
  conversationsAnalyzed?: number;
  topicsCreated?: number;
  topicsLabeled?: number;
  tokensIn?: number;
  tokensOut?: number;
  error?: string | null;
}

export async function finishRun(
  workspaceId: string,
  runId: string,
  input: FinishRunInput,
  client?: DatabaseClient,
): Promise<void> {
  await withDb(
    (db) =>
      db
        .update(conversationAnalysisRuns)
        .set({
          status: input.status,
          conversationsAnalyzed: input.conversationsAnalyzed ?? 0,
          topicsCreated: input.topicsCreated ?? 0,
          topicsLabeled: input.topicsLabeled ?? 0,
          tokensIn: input.tokensIn ?? 0,
          tokensOut: input.tokensOut ?? 0,
          error: input.error ?? null,
          finishedAt: new Date(),
        })
        .where(and(eq(conversationAnalysisRuns.workspaceId, workspaceId), eq(conversationAnalysisRuns.id, runId))),
    client,
  );
}

export async function findLatestRun(workspaceId: string, client?: DatabaseClient): Promise<AnalysisRun | null> {
  const rows = await withDb(
    (db) =>
      db
        .select(runColumns)
        .from(conversationAnalysisRuns)
        .where(eq(conversationAnalysisRuns.workspaceId, workspaceId))
        .orderBy(desc(conversationAnalysisRuns.startedAt))
        .limit(1),
    client,
  );
  return rows[0] ? mapRun(rows[0]) : null;
}

export async function listRuns(workspaceId: string, limit: number): Promise<AnalysisRun[]> {
  const rows = await withDb((db) =>
    db
      .select(runColumns)
      .from(conversationAnalysisRuns)
      .where(eq(conversationAnalysisRuns.workspaceId, workspaceId))
      .orderBy(desc(conversationAnalysisRuns.startedAt))
      .limit(limit),
  );
  return rows.map(mapRun);
}

/**
 * Releases a run that was left `running` by a process that died mid-analysis.
 *
 * The partial unique index means one abandoned row blocks every future run in
 * that workspace forever, and nothing else would ever clear it: the service
 * that would have finished it is gone. Anything older than the cutoff is
 * assumed dead rather than in flight.
 */
export async function failStaleRuns(workspaceId: string, olderThan: Date, client?: DatabaseClient): Promise<number> {
  const rows = await withDb(
    (db) =>
      db
        .update(conversationAnalysisRuns)
        .set({
          status: "failed",
          error: "The analysis stopped before it finished.",
          finishedAt: new Date(),
        })
        .where(
          and(
            eq(conversationAnalysisRuns.workspaceId, workspaceId),
            eq(conversationAnalysisRuns.status, "running"),
            sql`${conversationAnalysisRuns.startedAt} < ${olderThan}`,
          ),
        )
        .returning({ id: conversationAnalysisRuns.id }),
    client,
  );
  return rows.length;
}

/** Conversation ids already analyzed, so a run can skip re-embedding them. */
export async function listAnalyzedConversationIds(
  workspaceId: string,
  conversationIds: string[],
  client?: DatabaseClient,
): Promise<Set<string>> {
  if (conversationIds.length === 0) return new Set();
  const rows = await withDb(
    (db) =>
      db
        .select({ conversationId: conversationInsights.conversationId })
        .from(conversationInsights)
        .where(
          and(
            eq(conversationInsights.workspaceId, workspaceId),
            inArray(conversationInsights.conversationId, conversationIds),
          ),
        ),
    client,
  );
  return new Set(rows.map((row) => row.conversationId));
}
