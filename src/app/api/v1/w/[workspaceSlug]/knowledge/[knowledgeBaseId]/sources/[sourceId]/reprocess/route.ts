import { reprocessKnowledgeSource } from "@/features/knowledge/server/knowledge-service";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; knowledgeBaseId: string; sourceId: string };

export const POST = workspaceRoute<Params>(
  async ({ membership, user, params }) => {
    const source = await reprocessKnowledgeSource(
      { workspaceId: membership.workspace.id, userId: user.id },
      params.knowledgeBaseId,
      params.sourceId,
    );
    return ok(source);
  },
  { minimumRole: "member" },
);
