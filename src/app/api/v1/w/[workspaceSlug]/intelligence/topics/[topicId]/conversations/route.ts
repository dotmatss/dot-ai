import { topicConversationsQuerySchema } from "@/features/intelligence/schemas";
import { getTopicConversations } from "@/features/intelligence/server/intelligence-service";
import { parseSearchParams } from "@/server/http/request";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; topicId: string };

export const GET = workspaceRoute<Params>(async ({ request, membership, params }) => {
  const query = parseSearchParams(request, topicConversationsQuerySchema);
  const page = await getTopicConversations(membership.workspace.id, params.topicId, query);
  return ok(page);
});
