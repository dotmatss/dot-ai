import { parseTopicSort } from "@/features/intelligence/filters";
import { topicListQuerySchema } from "@/features/intelligence/schemas";
import { getTopics } from "@/features/intelligence/server/intelligence-service";
import { parseSearchParams } from "@/server/http/request";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

export const GET = workspaceRoute(async ({ request, membership }) => {
  const query = parseSearchParams(request, topicListQuerySchema);
  const page = await getTopics(membership.workspace.id, {
    search: query.q,
    gapsOnly: query.gaps || undefined,
    sort: parseTopicSort(query.sort),
    page: query.page,
    pageSize: query.pageSize,
  });
  return ok(page);
});
