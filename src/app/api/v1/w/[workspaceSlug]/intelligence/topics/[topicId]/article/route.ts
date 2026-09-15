import { draftArticleSchema } from "@/features/intelligence/schemas";
import { draftTopicArticle } from "@/features/intelligence/server/article-draft";
import { intelligenceActor } from "@/features/intelligence/server/intelligence-service";
import { parseJsonBody } from "@/server/http/request";
import { created } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; topicId: string };

/**
 * Drafts a knowledge article from a topic and files it.
 *
 * `member`, not `viewer`: this spends model tokens and creates a knowledge
 * source, which is a write to another feature's data.
 */
export const POST = workspaceRoute<Params>(
  async (ctx) => {
    const input = await parseJsonBody(ctx.request, draftArticleSchema);
    const draft = await draftTopicArticle(intelligenceActor(ctx), ctx.params.topicId, {
      collectionId: input.collectionId,
      signal: ctx.request.signal,
    });
    return created(draft);
  },
  { minimumRole: "member" },
);
