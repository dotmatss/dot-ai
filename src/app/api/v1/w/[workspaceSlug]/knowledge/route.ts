import { createKnowledgeBaseSchema, knowledgeBaseListQuerySchema } from "@/features/knowledge/schemas";
import { createKnowledgeBase, getKnowledgeBases } from "@/features/knowledge/server/knowledge-service";
import { parseJsonBody, parseSearchParams } from "@/server/http/request";
import { created, ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

export const GET = workspaceRoute(async ({ request, membership }) => {
  const filters = parseSearchParams(request, knowledgeBaseListQuerySchema);
  const page = await getKnowledgeBases(membership.workspace.id, filters);
  return ok(page);
});

export const POST = workspaceRoute(
  async ({ request, membership, user }) => {
    const input = await parseJsonBody(request, createKnowledgeBaseSchema);
    const base = await createKnowledgeBase({ workspaceId: membership.workspace.id, userId: user.id }, input);
    return created(base);
  },
  { minimumRole: "member" },
);
