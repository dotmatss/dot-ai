import { knowledgeSearchSchema } from "@/features/knowledge/schemas";
import { searchCollection } from "@/features/knowledge/server/knowledge-service";
import { parseJsonBody } from "@/server/http/request";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; collectionId: string };

/**
 * Read-only retrieval probe for the Test retrieval tab. POST because the query
 * is a body rather than a cacheable URL, but it changes nothing, so viewers may
 * call it.
 */
export const POST = workspaceRoute<Params>(async ({ request, membership, user, params }) => {
  const input = await parseJsonBody(request, knowledgeSearchSchema);
  const result = await searchCollection(
    { workspaceId: membership.workspace.id, userId: user.id },
    params.collectionId,
    input,
  );
  return ok(result);
});
