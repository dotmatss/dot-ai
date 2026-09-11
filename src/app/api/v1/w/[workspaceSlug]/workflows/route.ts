import { createWorkflowSchema, workflowListQuerySchema } from "@/features/workflows/schemas";
import { createWorkflow, getWorkflows } from "@/features/workflows/server/workflow-service";
import { parseJsonBody, parseSearchParams } from "@/server/http/request";
import { created, ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

export const GET = workspaceRoute(async ({ request, membership }) => {
  const filters = parseSearchParams(request, workflowListQuerySchema);
  const page = await getWorkflows(membership.workspace.id, filters);
  return ok(page);
});

export const POST = workspaceRoute(
  async ({ request, membership, user }) => {
    const input = await parseJsonBody(request, createWorkflowSchema);
    const workflow = await createWorkflow({ workspaceId: membership.workspace.id, userId: user.id }, input);
    return created(workflow);
  },
  { minimumRole: "member" },
);
