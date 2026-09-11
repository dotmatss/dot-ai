import { COLLECTIONS_OVERVIEW_LIMIT } from "@/features/knowledge/constants";
import { getKnowledgeOverview } from "@/features/knowledge/server/knowledge-service";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

/** Everything the Knowledge landing page needs, in one request. */
export const GET = workspaceRoute(async ({ membership }) => {
  const overview = await getKnowledgeOverview(membership.workspace.id, COLLECTIONS_OVERVIEW_LIMIT);
  return ok(overview);
});
