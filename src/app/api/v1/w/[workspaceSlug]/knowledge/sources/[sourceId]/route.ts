import { moveSourceSchema } from "@/features/knowledge/schemas";
import { deleteKnowledgeSource, getKnowledgeSource, moveKnowledgeSource } from "@/features/knowledge/server/knowledge-service";
import { parseJsonBody } from "@/server/http/request";
import { noContent, ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; sourceId: string };

export const GET = workspaceRoute<Params>(async ({ membership, params }) => {
  const source = await getKnowledgeSource(membership.workspace.id, params.sourceId);
  return ok(source);
});

/**
 * Filing a document into a collection, or back into Unorganized with a null id.
 *
 * This is a `member` action while deletion is `admin`: moving a document is
 * reversible and destroys nothing, and making organisation an admin-only chore
 * is how Unorganized fills up and stays full.
 */
export const PATCH = workspaceRoute<Params>(
  async ({ request, membership, user, params }) => {
    const input = await parseJsonBody(request, moveSourceSchema);
    const source = await moveKnowledgeSource(
      { workspaceId: membership.workspace.id, userId: user.id },
      params.sourceId,
      input,
    );
    return ok(source);
  },
  { minimumRole: "member" },
);

/** Removing a source destroys its indexed passages, so it is an admin action. */
export const DELETE = workspaceRoute<Params>(
  async ({ membership, user, params }) => {
    await deleteKnowledgeSource({ workspaceId: membership.workspace.id, userId: user.id }, params.sourceId);
    return noContent();
  },
  { minimumRole: "admin" },
);
