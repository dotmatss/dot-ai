import { getWorkflowRun } from "@/features/workflows/server/workflow-service";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; workflowId: string; runId: string };

export const GET = workspaceRoute<Params>(async ({ membership, params }) => {
  const run = await getWorkflowRun(membership.workspace.id, params.workflowId, params.runId);
  return ok(run);
});
