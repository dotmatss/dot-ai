import { deleteKnowledgeSource } from "@/features/knowledge/server/knowledge-service";
import { noContent } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; knowledgeBaseId: string; sourceId: string };

/**
 * Removing a source destroys its indexed passages, so it is an admin action —
 * the same bar as deleting the knowledge base itself.
 */
export const DELETE = workspaceRoute<Params>(
  async ({ membership, user, params }) => {
    await deleteKnowledgeSource(
      { workspaceId: membership.workspace.id, userId: user.id },
      params.knowledgeBaseId,
      params.sourceId,
    );
    return noContent();
  },
  { minimumRole: "admin" },
);
