import { updateCollectionSchema } from "@/features/knowledge/schemas";
import { deleteCollection, getCollection, updateCollection } from "@/features/knowledge/server/knowledge-service";
import { parseJsonBody } from "@/server/http/request";
import { noContent, ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; collectionId: string };

export const GET = workspaceRoute<Params>(async ({ membership, params }) => {
  const collection = await getCollection(membership.workspace.id, params.collectionId);
  return ok(collection);
});

export const PATCH = workspaceRoute<Params>(
  async ({ request, membership, user, params }) => {
    const input = await parseJsonBody(request, updateCollectionSchema);
    const collection = await updateCollection(
      { workspaceId: membership.workspace.id, userId: user.id },
      params.collectionId,
      input,
    );
    return ok(collection);
  },
  { minimumRole: "member" },
);

/**
 * Deleting a collection un-files its documents rather than destroying them, so
 * this is recoverable — but it silently narrows what every attached chatbot and
 * agent can answer from, which is why it stays an admin action.
 */
export const DELETE = workspaceRoute<Params>(
  async ({ membership, user, params }) => {
    await deleteCollection({ workspaceId: membership.workspace.id, userId: user.id }, params.collectionId);
    return noContent();
  },
  { minimumRole: "admin" },
);
