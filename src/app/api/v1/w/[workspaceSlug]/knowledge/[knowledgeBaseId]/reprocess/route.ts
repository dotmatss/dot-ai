import { reprocessKnowledgeBase } from "@/features/knowledge/server/knowledge-service";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; knowledgeBaseId: string };

/**
 * Re-runs the ingestion pipeline for every source. Processing is inline, so
 * this request is as slow as the sources are large; the sources it has already
 * finished are visible in the sources list while it runs.
 */
export const POST = workspaceRoute<Params>(
  async ({ membership, user, params }) => {
    const base = await reprocessKnowledgeBase(
      { workspaceId: membership.workspace.id, userId: user.id },
      params.knowledgeBaseId,
    );
    return ok(base);
  },
  { minimumRole: "member" },
);
