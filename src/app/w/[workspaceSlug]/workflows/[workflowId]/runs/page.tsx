import type { Metadata } from "next";

import { WorkflowRunsPanel } from "@/features/workflows/components/workflow-runs-panel";
import { parseWorkflowRunFilters } from "@/features/workflows/filters";
import { workflowKeys } from "@/features/workflows/queries";
import { listWorkflowRuns } from "@/features/workflows/server/workflow-run-repository";
import { HydrateClient } from "@/lib/query/hydrate";
import { makeQueryClient } from "@/lib/query/query-client";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Workflow runs" };

export default async function WorkflowRunsPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/workflows/[workflowId]/runs">) {
  const [{ workspaceSlug, workflowId }, query] = await Promise.all([params, searchParams]);
  const { membership } = await requireWorkspaceAccess(workspaceSlug);
  const filters = parseWorkflowRunFilters(query);

  const queryClient = makeQueryClient();
  queryClient.setQueryData(
    workflowKeys.runList(workspaceSlug, workflowId, filters),
    await listWorkflowRuns(membership.workspace.id, workflowId, filters),
  );

  return (
    <HydrateClient queryClient={queryClient}>
      <WorkflowRunsPanel workflowId={workflowId} />
    </HydrateClient>
  );
}
