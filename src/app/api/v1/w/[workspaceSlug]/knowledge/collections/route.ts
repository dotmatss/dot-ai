import { collectionListQuerySchema, createCollectionSchema } from "@/features/knowledge/schemas";
import { createCollection, getCollections } from "@/features/knowledge/server/knowledge-service";
import { parseJsonBody, parseSearchParams } from "@/server/http/request";
import { created, ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

export const GET = workspaceRoute(async ({ request, membership }) => {
  const filters = parseSearchParams(request, collectionListQuerySchema);
  const page = await getCollections(membership.workspace.id, filters);
  return ok(page);
});

export const POST = workspaceRoute(
  async ({ request, membership, user }) => {
    const input = await parseJsonBody(request, createCollectionSchema);
    const collection = await createCollection({ workspaceId: membership.workspace.id, userId: user.id }, input);
    return created(collection);
  },
  { minimumRole: "member" },
);
