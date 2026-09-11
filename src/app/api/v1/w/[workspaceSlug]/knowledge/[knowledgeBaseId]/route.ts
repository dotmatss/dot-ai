import { updateKnowledgeBaseSchema } from "@/features/knowledge/schemas";
import { deleteKnowledgeBase, getKnowledgeBase, updateKnowledgeBase } from "@/features/knowledge/server/knowledge-service";
import { parseJsonBody } from "@/server/http/request";
import { noContent, ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; knowledgeBaseId: string };

export const GET = workspaceRoute<Params>(async ({ membership, params }) => {
  const base = await getKnowledgeBase(membership.workspace.id, params.knowledgeBaseId);
  return ok(base);
});

export const PATCH = workspaceRoute<Params>(
  async ({ request, membership, user, params }) => {
    const input = await parseJsonBody(request, updateKnowledgeBaseSchema);
    const base = await updateKnowledgeBase(
      { workspaceId: membership.workspace.id, userId: user.id },
      params.knowledgeBaseId,
      input,
    );
    return ok(base);
  },
  { minimumRole: "member" },
);

export const DELETE = workspaceRoute<Params>(
  async ({ membership, user, params }) => {
    await deleteKnowledgeBase({ workspaceId: membership.workspace.id, userId: user.id }, params.knowledgeBaseId);
    return noContent();
  },
  { minimumRole: "admin" },
);
