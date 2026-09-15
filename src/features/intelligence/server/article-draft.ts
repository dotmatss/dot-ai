import "server-only";

import {
  ARTICLE_SYSTEM_PROMPT,
  buildArticlePrompt,
  clampArticle,
  deriveArticleTitle,
} from "@/features/intelligence/article-prompt";
import { DRAFT_MAX_OUTPUT_TOKENS, DRAFT_MAX_QUESTIONS } from "@/features/intelligence/constants";
import {
  findTopicById,
  listTopicQuestions,
} from "@/features/intelligence/server/intelligence-repository";
import type { ActorContext } from "@/features/intelligence/server/intelligence-service";
import type { TopicArticleDraft } from "@/features/intelligence/types";
import { createKnowledgeSource } from "@/features/knowledge/server/knowledge-service";
import { ApiError } from "@/lib/api/api-error";
import { recordActivity } from "@/server/activity/activity-log";
import { getAiGateway } from "@/server/ai";
import { withWorkspace } from "@/server/db/client";
import { recordUsageBatch, type UsageKind } from "@/server/usage/record-usage";
import type { ChatMessage } from "@/types/ai";

/**
 * Turns a topic into the first draft of a knowledge article.
 *
 * This is the action the rest of the feature exists to enable: a topic with
 * poor coverage is a list of questions nobody has documented, and this files
 * the skeleton of the answer into the knowledge base for a person to complete.
 *
 * WHAT IT REFUSES TO DO
 * ---------------------
 * The model is given the questions and not the answers, and the prompt forbids
 * it from supplying any - see `article-prompt.ts` for why an invented knowledge
 * source is worse than the gap it fills.
 *
 * WHERE IT FILES THE DRAFT
 * ------------------------
 * Unorganized by default. The knowledge feature treats an unorganized source as
 * unreachable by every agent (see `retrieval.ts`: there is no "search
 * everything" mode), so a half-written article cannot be retrieved and cited
 * until somebody has read it and filed it into a collection. The default is the
 * safe one, and choosing a collection is an explicit act.
 *
 * WHY IT CROSSES INTO KNOWLEDGE THROUGH THE SERVICE
 * -------------------------------------------------
 * `createKnowledgeSource` runs the ingestion pipeline: chunking, embedding,
 * status roll-up on the collection. Writing the row directly would produce a
 * source that exists and is never indexed, which is the sort of half-created
 * record that looks fine in a list and is invisible to retrieval.
 */

export interface DraftTopicArticleOptions {
  collectionId: string | null;
  signal?: AbortSignal;
}

export async function draftTopicArticle(
  ctx: ActorContext,
  topicId: string,
  options: DraftTopicArticleOptions,
): Promise<TopicArticleDraft> {
  const topic = await findTopicById(ctx.workspaceId, topicId);
  if (!topic) throw ApiError.notFound("Topic not found");

  const questions = await listTopicQuestions(ctx.workspaceId, topicId, DRAFT_MAX_QUESTIONS);
  if (questions.length === 0) {
    throw ApiError.badRequest("This topic has no questions to draft from yet");
  }

  const ungroundedCount = Math.max(0, topic.conversationCount - topic.groundedCount);

  const messages: ChatMessage[] = [
    { role: "system", content: ARTICLE_SYSTEM_PROMPT },
    {
      role: "user",
      content: buildArticlePrompt({
        topicLabel: topic.label,
        topicSummary: topic.summary,
        questions,
        ungroundedCount,
        conversationCount: topic.conversationCount,
      }),
    },
  ];

  const gateway = getAiGateway();
  let text = "";
  let tokensIn = 0;
  let tokensOut = 0;

  for await (const event of gateway.streamChat({
    messages,
    temperature: 0.2,
    maxTokens: DRAFT_MAX_OUTPUT_TOKENS,
    metadata: { feature: "intelligence_article_draft", workspaceId: ctx.workspaceId },
    signal: options.signal,
  })) {
    if (event.type === "text-delta") text += event.delta;
    else if (event.type === "usage") {
      tokensIn = event.usage.inputTokens;
      tokensOut = event.usage.outputTokens;
    } else if (event.type === "error") {
      throw ApiError.unavailable(event.message);
    } else if (event.type === "done" && event.finishReason === "error") {
      throw ApiError.unavailable("The AI gateway could not finish the draft");
    }
  }

  const content = clampArticle(text);
  // An empty draft is not filed. A knowledge source with no content indexes to
  // nothing and shows up as a ready source that answers no question.
  if (!content) throw ApiError.unavailable("The AI gateway returned an empty draft");

  const title = deriveArticleTitle(content, topic.label).slice(0, 160);

  // Ingestion runs inside `createKnowledgeSource` and takes its own
  // transaction, so it is called before this feature opens one of its own.
  const source = await createKnowledgeSource(
    { workspaceId: ctx.workspaceId, userId: ctx.userId },
    options.collectionId,
    { type: "text", name: title, content },
  );

  await withWorkspace(ctx.workspaceId, async (client) => {
    const usage: Array<{ kind: UsageKind; quantity: number; refType: string; refId: string }> = [
      { kind: "tokens_in", quantity: tokensIn, refType: "conversation_topic", refId: topicId },
      { kind: "tokens_out", quantity: tokensOut, refType: "conversation_topic", refId: topicId },
    ];
    await recordUsageBatch(
      ctx.workspaceId,
      usage.filter((event) => event.quantity > 0),
      client,
    );

    await recordActivity(
      {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        entityType: "conversation_topic",
        entityId: topicId,
        action: "article_drafted",
        summary: `Drafted a knowledge article from “${topic.label}”`,
        metadata: { knowledgeSourceId: source.id, questions: questions.length, collectionId: options.collectionId },
      },
      client,
    );
  });

  return { topicId, title, content, knowledgeSourceId: source.id };
}
