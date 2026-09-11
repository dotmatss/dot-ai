import {
  createSourceSchema,
  createSourceTargetSchema,
  knowledgeSourceListQuerySchema,
  toKnowledgeScope,
} from "@/features/knowledge/schemas";
import { createKnowledgeSource, getKnowledgeSources } from "@/features/knowledge/server/knowledge-service";
import { parseJsonBody, parseSearchParams } from "@/server/http/request";
import { created, ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

/**
 * Documents are workspace-scoped, not nested under a collection, because a
 * document can legitimately belong to none. `?scope=` selects between all
 * documents, the unorganized ones, and a single collection.
 */
export const GET = workspaceRoute(async ({ request, membership }) => {
  const { scope, ...filters } = parseSearchParams(request, knowledgeSourceListQuerySchema);
  const page = await getKnowledgeSources(membership.workspace.id, toKnowledgeScope(scope), filters);
  return ok(page);
});

/** Text and URL sources. File uploads use ./upload, which takes multipart. */
export const POST = workspaceRoute(
  async ({ request, membership, user }) => {
    const { collectionId } = parseSearchParams(request, createSourceTargetSchema);
    const input = await parseJsonBody(request, createSourceSchema);
    const source = await createKnowledgeSource(
      { workspaceId: membership.workspace.id, userId: user.id },
      collectionId ?? null,
      input,
    );
    return created(source);
  },
  { minimumRole: "member" },
);
