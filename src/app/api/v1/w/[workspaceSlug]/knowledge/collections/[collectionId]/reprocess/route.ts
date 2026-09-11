import { reprocessCollection } from "@/features/knowledge/server/knowledge-service";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; collectionId: string };

/**
 * Re-runs the ingestion pipeline for every source in the collection. Processing
 * is inline, so this request is as slow as the sources are large; the sources it
 * has already finished are visible in the sources list while it runs.
 */
export const POST = workspaceRoute<Params>(
  async ({ membership, user, params }) => {
    const collection = await reprocessCollection(
      { workspaceId: membership.workspace.id, userId: user.id },
      params.collectionId,
    );
    return ok(collection);
  },
  { minimumRole: "member" },
);
