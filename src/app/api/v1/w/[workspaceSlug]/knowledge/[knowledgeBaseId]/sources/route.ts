import { createSourceSchema, knowledgeSourceListQuerySchema } from "@/features/knowledge/schemas";
import { createKnowledgeSource, getKnowledgeSources } from "@/features/knowledge/server/knowledge-service";
import { parseJsonBody, parseSearchParams } from "@/server/http/request";
import { created, ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; knowledgeBaseId: string };

export const GET = workspaceRoute<Params>(async ({ request, membership, params }) => {
  const filters = parseSearchParams(request, knowledgeSourceListQuerySchema);
  const page = await getKnowledgeSources(membership.workspace.id, params.knowledgeBaseId, filters);
  return ok(page);
});

/** Text and URL sources. File uploads use ./upload, which takes multipart. */
export const POST = workspaceRoute<Params>(
  async ({ request, membership, user, params }) => {
    const input = await parseJsonBody(request, createSourceSchema);
    const source = await createKnowledgeSource(
      { workspaceId: membership.workspace.id, userId: user.id },
      params.knowledgeBaseId,
      input,
    );
    return created(source);
  },
  { minimumRole: "member" },
);
