import { updateWorkflowSchema } from "@/features/workflows/schemas";
import { deleteWorkflow, getWorkflow, updateWorkflow } from "@/features/workflows/server/workflow-service";
import { parseJsonBody } from "@/server/http/request";
import { noContent, ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; workflowId: string };

export const GET = workspaceRoute<Params>(async ({ membership, params }) => {
  const workflow = await getWorkflow(membership.workspace.id, params.workflowId);
  return ok(workflow);
});

export const PATCH = workspaceRoute<Params>(
  async ({ request, membership, user, params }) => {
    const input = await parseJsonBody(request, updateWorkflowSchema);
    const workflow = await updateWorkflow({ workspaceId: membership.workspace.id, userId: user.id }, params.workflowId, input);
    return ok(workflow);
  },
  { minimumRole: "member" },
);

export const DELETE = workspaceRoute<Params>(
  async ({ membership, user, params }) => {
    await deleteWorkflow({ workspaceId: membership.workspace.id, userId: user.id }, params.workflowId);
    return noContent();
  },
  { minimumRole: "admin" },
);
