import { updateTopicSchema } from "@/features/intelligence/schemas";
import { getTopic, intelligenceActor, updateTopic } from "@/features/intelligence/server/intelligence-service";
import { parseJsonBody } from "@/server/http/request";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; topicId: string };

export const GET = workspaceRoute<Params>(async ({ membership, params }) => {
  const topic = await getTopic(membership.workspace.id, params.topicId);
  return ok(topic);
});

/**
 * Renaming a topic the model named badly.
 *
 * There is no DELETE. A topic is derived from the insights pointing at it, so
 * deleting the row would only have it rebuilt by the next run under a new id -
 * and the conversations would lose the label somebody had corrected.
 */
export const PATCH = workspaceRoute<Params>(
  async (ctx) => {
    const input = await parseJsonBody(ctx.request, updateTopicSchema);
    const topic = await updateTopic(intelligenceActor(ctx), ctx.params.topicId, input);
    return ok(topic);
  },
  { minimumRole: "member" },
);
