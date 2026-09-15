import "server-only";

import { listConversationBriefs } from "@/features/conversations/server/analysis-source";
import { TOPIC_EXAMPLE_LIMIT } from "@/features/intelligence/constants";
import { runConversationAnalysis } from "@/features/intelligence/server/analysis-run";
import {
  findTopicWithExamples,
  getOverview,
  listRuns,
  listTopicInsights,
  listTopics,
  updateTopicRow,
} from "@/features/intelligence/server/intelligence-repository";
import type { RunAnalysisInput, UpdateTopicInput } from "@/features/intelligence/schemas";
import type {
  AnalysisRun,
  IntelligenceDashboard,
  Topic,
  TopicConversation,
  TopicListFilters,
  TopicSummary,
} from "@/features/intelligence/types";
import type { MemberRole } from "@/features/workspaces/roles";
import { ApiError } from "@/lib/api/api-error";
import { recordActivity } from "@/server/activity/activity-log";
import type { WorkspaceContext } from "@/server/auth/dal";
import { withWorkspace } from "@/server/db/client";
import type { Paginated } from "@/types/pagination";

/**
 * Business rules for Conversation Intelligence.
 *
 * Reads are thin over the repository. The two writes that matter - starting an
 * analysis and drafting an article - both cost money and both cross a feature
 * boundary, so each is its own module and this one composes them.
 */

/** Runs kept on the page. Enough to see a pattern of failures, not an archive. */
export const RUN_HISTORY_LIMIT = 10;

export interface ActorContext {
  workspaceId: string;
  userId: string;
  actorName: string;
  role: MemberRole;
}

export function intelligenceActor(ctx: WorkspaceContext): ActorContext {
  return {
    workspaceId: ctx.membership.workspace.id,
    userId: ctx.user.id,
    actorName: ctx.user.name,
    role: ctx.membership.role,
  };
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export function getTopics(workspaceId: string, filters: TopicListFilters): Promise<Paginated<TopicSummary>> {
  return listTopics(workspaceId, filters);
}

export async function getTopic(workspaceId: string, topicId: string): Promise<Topic> {
  const topic = await findTopicWithExamples(workspaceId, topicId, TOPIC_EXAMPLE_LIMIT);
  if (!topic) throw ApiError.notFound("Topic not found");
  return topic;
}

/**
 * The whole Intelligence landing page in one read.
 *
 * The three parts go out together rather than as three endpoints because they
 * are one screen and they must describe the same instant: an overview from
 * after a run paired with topics from before it would show totals that do not
 * add up to the rows underneath them.
 */
export async function getDashboard(workspaceId: string, filters: TopicListFilters): Promise<IntelligenceDashboard> {
  const [overview, topics, runs] = await Promise.all([
    getOverview(workspaceId),
    listTopics(workspaceId, filters),
    listRuns(workspaceId, RUN_HISTORY_LIMIT),
  ]);
  return { overview, topics: topics.items, runs };
}

export function getAnalysisRuns(workspaceId: string, limit = RUN_HISTORY_LIMIT): Promise<AnalysisRun[]> {
  return listRuns(workspaceId, limit);
}

/**
 * A topic's conversations, with enough of each thread to render a row.
 *
 * Two reads rather than a join, and deliberately so: `conversations` belongs to
 * another feature, and this feature does not write SQL over it. The insight
 * rows come from here and are hydrated through `listConversationBriefs`, which
 * the conversations feature exports for exactly this.
 *
 * A conversation that has since been deleted simply drops out. Its insight row
 * is cascaded away by the foreign key anyway; the filter covers the window
 * between the delete and the next run.
 */
export async function getTopicConversations(
  workspaceId: string,
  topicId: string,
  page: { page: number; pageSize: number },
): Promise<Paginated<TopicConversation>> {
  const topic = await findTopicWithExamples(workspaceId, topicId, 0);
  if (!topic) throw ApiError.notFound("Topic not found");

  const insights = await listTopicInsights(workspaceId, topicId, page);
  const briefs = await listConversationBriefs(
    workspaceId,
    insights.items.map((insight) => insight.conversationId),
  );
  const briefById = new Map(briefs.map((brief) => [brief.id, brief]));

  const items = insights.items.flatMap((insight) => {
    const brief = briefById.get(insight.conversationId);
    if (!brief) return [];
    return [
      {
        ...insight,
        title: brief.title,
        status: brief.status,
        channel: brief.channel,
        messageCount: brief.messageCount,
        lastMessageAt: brief.lastMessageAt,
        createdAt: brief.createdAt,
      } satisfies TopicConversation,
    ];
  });

  return { ...insights, items };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Renames a topic, or rewrites its summary.
 *
 * `labeled_at` is NOT advanced here. A human edit is not a model labelling, and
 * leaving the timestamp alone is what lets the next run see the topic as
 * already named and leave it alone - if this bumped it, the run's growth check
 * would eventually overwrite the name a person chose.
 */
export async function updateTopic(ctx: ActorContext, topicId: string, input: UpdateTopicInput): Promise<Topic> {
  const existing = await findTopicWithExamples(ctx.workspaceId, topicId, 0);
  if (!existing) throw ApiError.notFound("Topic not found");

  const patch: { label?: string; summary?: string | null } = {};
  if (typeof input.label === "string") patch.label = input.label.trim();
  if (input.summary !== undefined) patch.summary = input.summary === null ? null : String(input.summary).trim() || null;
  if (Object.keys(patch).length === 0) throw ApiError.badRequest("Nothing to update");

  await withWorkspace(ctx.workspaceId, async (client) => {
    await updateTopicRow(ctx.workspaceId, topicId, patch, client);
    await recordActivity(
      {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        entityType: "conversation_topic",
        entityId: topicId,
        action: "updated",
        summary: `Renamed topic “${existing.label}”`,
        metadata: { label: patch.label ?? existing.label },
      },
      client,
    );
  });

  return getTopic(ctx.workspaceId, topicId);
}

/**
 * Starts an analysis and waits for it.
 *
 * The caller waits, as they do for knowledge ingestion: there is no job runner
 * here, and the run is bounded by `MAX_CONVERSATIONS_PER_RUN` and
 * `MAX_TOPICS_LABELED_PER_RUN` so the wait has a ceiling. A second concurrent
 * request is refused by the database rather than queued.
 */
export function startAnalysis(ctx: ActorContext, input: RunAnalysisInput, signal?: AbortSignal): Promise<AnalysisRun> {
  return runConversationAnalysis({
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    actorName: ctx.actorName,
    windowDays: input.windowDays,
    signal,
  });
}
