import "server-only";

import {
  listConversationsForAnalysis,
  type ConversationAnalysisRow,
} from "@/features/conversations/server/analysis-source";
import { EMBEDDING_BATCH_SIZE, getEmbeddingProvider } from "@/features/knowledge/server/embeddings";
import {
  assignToCluster,
  foldIntoCluster,
  type Cluster,
} from "@/features/intelligence/clustering";
import {
  MAX_CONVERSATIONS_PER_RUN,
  MAX_QUESTION_CHARS,
  MAX_TOPICS_PER_WORKSPACE,
  TOPIC_SIMILARITY_THRESHOLD,
} from "@/features/intelligence/constants";
import { deriveFallbackLabel } from "@/features/intelligence/label-prompt";
import { deriveOutcome, isGrounded } from "@/features/intelligence/metrics";
import {
  deleteEmptyTopics,
  failStaleRuns,
  findLatestRun,
  finishRun,
  insertRun,
  insertTopic,
  listTopicCentroids,
  recomputeTopicCounters,
  updateTopicCentroid,
  upsertInsights,
  type UpsertInsightInput,
} from "@/features/intelligence/server/intelligence-repository";
import { labelTopics, type LabelingResult } from "@/features/intelligence/server/topic-labeling";
import type { AnalysisRun } from "@/features/intelligence/types";
import { ApiError } from "@/lib/api/api-error";
import { recordActivity } from "@/server/activity/activity-log";
import { withWorkspace } from "@/server/db/client";
import { recordUsageBatch, type UsageKind } from "@/server/usage/record-usage";

/**
 * One pass of Conversation Intelligence over a workspace.
 *
 * SHAPE OF THE RUN, AND WHY IT IS SPLIT THIS WAY
 * ---------------------------------------------
 * Three phases, and the split is about what must not happen inside a database
 * transaction:
 *
 *   1. Read and embed (no transaction). Loads the window through the
 *      conversations read model and turns each opening question into a vector.
 *   2. Cluster and persist (ONE transaction, no network). Pure in-memory
 *      assignment, then the writes. Nothing here can block on a provider.
 *   3. Label (no transaction, one model call per topic). Each label is its own
 *      small write.
 *
 * Phase 2 is a transaction because the insights and the counters derived from
 * them have to land together. Phases 1 and 3 are outside it because they make
 * network calls, and holding a pooled connection open across a model call is
 * how one slow provider becomes a database outage.
 *
 * `processSource` in the knowledge pipeline sets the precedent for running this
 * inline with the caller waiting rather than on a queue: there is no job runner
 * in this codebase, and inventing one for a single feature would be the wrong
 * place to introduce it. What bounds the wait instead is
 * `MAX_CONVERSATIONS_PER_RUN` and `MAX_TOPICS_LABELED_PER_RUN`.
 */

/** A run left `running` for longer than this is assumed dead, not in flight. */
const STALE_RUN_MINUTES = 30;

export interface RunAnalysisOptions {
  workspaceId: string;
  userId: string | null;
  actorName?: string | null;
  windowDays: number;
  signal?: AbortSignal;
}

interface PreparedConversation {
  row: ConversationAnalysisRow;
  question: string;
  vector: number[];
}

export async function runConversationAnalysis(options: RunAnalysisOptions): Promise<AnalysisRun> {
  const { workspaceId } = options;
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - options.windowDays * 24 * 60 * 60 * 1000);

  // Clear anything abandoned before trying to claim the slot, or a crashed run
  // locks the workspace out of the feature permanently.
  await failStaleRuns(workspaceId, new Date(Date.now() - STALE_RUN_MINUTES * 60 * 1000));

  const runId = await claimRun(workspaceId, windowStart, windowEnd, options.userId);

  try {
    /* Phase 1 - read and embed. ------------------------------------------- */
    const rows = await listConversationsForAnalysis(workspaceId, {
      since: windowStart,
      limit: MAX_CONVERSATIONS_PER_RUN,
    });

    if (rows.length === 0) {
      await finishRun(workspaceId, runId, { status: "succeeded", conversationsAnalyzed: 0 });
      return requireRun(workspaceId, runId);
    }

    const prepared = await embedQuestions(rows, options.signal);

    /* Phase 2 - cluster and persist. -------------------------------------- */
    const { topicsCreated, analyzed } = await withWorkspace(workspaceId, async (client) => {
      const provider = getEmbeddingProvider();
      const embeddingConfig = { provider: provider.provider, dimensions: provider.dimensions };

      const existing = await listTopicCentroids(workspaceId, client);

      // A centroid built by a different model, or at a different dimension
      // count, is not comparable to today's vectors - cosine against it returns
      // a number that means nothing. Such topics keep their members and their
      // counters but take no new ones, rather than quietly corrupting a space.
      const comparable = existing.filter(
        (topic) =>
          topic.centroid.length === provider.dimensions &&
          (topic.embeddingConfig.provider ?? provider.provider) === provider.provider,
      );

      const clusters: Cluster[] = comparable.map((topic) => ({
        centroid: topic.centroid,
        size: Math.max(topic.size, 1),
      }));
      // Positional: clusters[i] is topicIds[i]. `null` marks a cluster created
      // during this pass whose row has not been inserted yet.
      const topicIds: Array<string | null> = comparable.map((topic) => topic.id);
      const touched = new Set<number>();
      let created = 0;

      const insights: UpsertInsightInput[] = [];
      // Parallel to `insights`: which cluster each one landed in, or null when
      // it landed in none. Scaffolding for this pass only, which is why it is
      // not a field on `UpsertInsightInput` - a column-shaped property there
      // would eventually find its way into the insert.
      const clusterIndexes: Array<number | null> = [];

      for (const item of prepared) {
        const assignment = assignToCluster({
          vector: item.vector,
          clusters,
          threshold: TOPIC_SIMILARITY_THRESHOLD,
          maxClusters: MAX_TOPICS_PER_WORKSPACE,
        });

        let index: number | null = null;
        let similarity: number | null = null;

        if (assignment.kind === "created") {
          clusters.push({ centroid: item.vector, size: 1 });
          topicIds.push(null);
          index = clusters.length - 1;
          created += 1;
        } else if (assignment.kind === "joined" || assignment.kind === "forced") {
          index = assignment.index;
          similarity = assignment.similarity;
          const cluster = clusters[index];
          if (cluster) clusters[index] = foldIntoCluster(cluster, item.vector);
        }
        // "skipped" leaves index null: the conversation is still recorded, with
        // no topic. Its outcome and grounding are facts worth keeping even when
        // there was nothing clusterable to say about the question.

        if (index !== null) touched.add(index);

        insights.push({
          workspaceId,
          conversationId: item.row.conversationId,
          topicId: null, // resolved below, once every new topic has an id
          question: item.question,
          embedding: item.vector,
          outcome: deriveOutcome({ status: item.row.status, humanReplyCount: item.row.humanReplyCount }),
          grounded: isGrounded(item.row.sourceCount),
          userMessageCount: item.row.userMessageCount,
          sourceCount: item.row.sourceCount,
          topicSimilarity: similarity,
          // The thread's own clock. `lastMessageAt` is when it was last active
          // and is what "last seen" on a topic should mean; a thread with no
          // reply yet falls back to when it was opened.
          conversationAt: new Date(item.row.lastMessageAt ?? item.row.createdAt),
          analyzedAt: new Date(),
        });
        clusterIndexes.push(index);
      }

      // Insert the rows for clusters founded during this pass. A new topic is
      // named from its own questions so it is readable immediately; phase 3
      // replaces that with a model-written label.
      for (let index = 0; index < clusters.length; index += 1) {
        if (topicIds[index] !== null) continue;
        const questions = insights
          .filter((_, position) => clusterIndexes[position] === index)
          .map((insight) => insight.question);
        const cluster = clusters[index];
        if (!cluster) continue;
        topicIds[index] = await insertTopic(
          {
            workspaceId,
            label: deriveFallbackLabel(questions),
            centroid: cluster.centroid,
            embeddingConfig,
            firstSeenAt: windowStart,
            lastSeenAt: windowEnd,
          },
          client,
        );
      }

      insights.forEach((insight, position) => {
        const index = clusterIndexes[position];
        insight.topicId = index === null || index === undefined ? null : (topicIds[index] ?? null);
      });

      // Centroids of pre-existing clusters that gained members this run.
      for (const index of touched) {
        const id = topicIds[index];
        const cluster = clusters[index];
        if (!id || !cluster) continue;
        if (comparable.some((topic) => topic.id === id)) {
          await updateTopicCentroid(workspaceId, id, cluster.centroid, windowEnd, client);
        }
      }

      await upsertInsights(insights, client);
      // Counters are rebuilt from the insights that now exist rather than
      // incremented alongside them, so a partial run cannot leave them skewed.
      await recomputeTopicCounters(workspaceId, client);
      await deleteEmptyTopics(workspaceId, client);

      return { topicsCreated: created, analyzed: insights.length };
    });

    /* Phase 3 - label. ----------------------------------------------------- */
    const labeling: LabelingResult = await labelTopics({ workspaceId, signal: options.signal });

    await withWorkspace(workspaceId, async (client) => {
      await finishRun(
        workspaceId,
        runId,
        {
          status: "succeeded",
          conversationsAnalyzed: analyzed,
          topicsCreated,
          topicsLabeled: labeling.labeled,
          tokensIn: labeling.tokensIn,
          tokensOut: labeling.tokensOut,
        },
        client,
      );

      const usage: Array<{ kind: UsageKind; quantity: number; refType: string; refId: string }> = [
        { kind: "tokens_in", quantity: labeling.tokensIn, refType: "analysis_run", refId: runId },
        { kind: "tokens_out", quantity: labeling.tokensOut, refType: "analysis_run", refId: runId },
      ];
      await recordUsageBatch(
        workspaceId,
        usage.filter((event) => event.quantity > 0),
        client,
      );

      await recordActivity(
        {
          workspaceId,
          actorId: options.userId,
          entityType: "analysis_run",
          entityId: runId,
          action: "completed",
          summary: `Analyzed ${analyzed} conversation${analyzed === 1 ? "" : "s"} into topics`,
          metadata: { topicsCreated, topicsLabeled: labeling.labeled, windowDays: options.windowDays },
        },
        client,
      );
    });

    return requireRun(workspaceId, runId);
  } catch (error) {
    // The run row is the only record that something was attempted, so a failure
    // is written back before the error propagates. The message is deliberately
    // ours rather than the provider's: this string is rendered.
    await finishRun(workspaceId, runId, {
      status: "failed",
      error: error instanceof ApiError ? error.message : "The analysis did not finish.",
    }).catch(() => undefined);
    throw error;
  }
}

/**
 * Takes the one-run-per-workspace slot.
 *
 * The partial unique index is what actually enforces this, so a second caller
 * gets a unique violation rather than a second run. `translateDbError` has
 * already turned that into a 409 by the time it arrives here; it is re-thrown
 * with a message about analyses rather than about rows.
 */
async function claimRun(
  workspaceId: string,
  windowStart: Date,
  windowEnd: Date,
  userId: string | null,
): Promise<string> {
  try {
    return await withWorkspace(workspaceId, (client) =>
      insertRun({ workspaceId, windowStart, windowEnd, startedBy: userId }, client),
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      throw ApiError.conflict("An analysis is already running for this workspace");
    }
    throw error;
  }
}

async function requireRun(workspaceId: string, runId: string): Promise<AnalysisRun> {
  const run = await findLatestRun(workspaceId);
  if (!run || run.id !== runId) throw new Error("Analysis run vanished after finishing");
  return run;
}

/**
 * Embeds each conversation's opening question.
 *
 * Batched, because a hosted provider is charged and rate-limited per request
 * and `MockEmbeddingProvider` is the only one for which the batch size does not
 * matter. Questions are clipped first so one pasted stack trace cannot
 * dominate a batch.
 */
async function embedQuestions(
  rows: ConversationAnalysisRow[],
  signal?: AbortSignal,
): Promise<PreparedConversation[]> {
  const provider = getEmbeddingProvider();
  const questions = rows.map((row) => row.question.trim().slice(0, MAX_QUESTION_CHARS));
  const prepared: PreparedConversation[] = [];

  for (let start = 0; start < questions.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = questions.slice(start, start + EMBEDDING_BATCH_SIZE);
    const vectors = await provider.embed(batch, signal);
    batch.forEach((question, offset) => {
      const row = rows[start + offset];
      if (!row) return;
      prepared.push({ row, question, vector: vectors[offset] ?? [] });
    });
  }

  return prepared;
}
