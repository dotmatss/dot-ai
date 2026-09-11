import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { WorkflowRunDetail } from "@/features/workflows/components/workflow-run-detail";
import { workflowKeys } from "@/features/workflows/queries";
import { findWorkflowRunById } from "@/features/workflows/server/workflow-run-repository";
import { HydrateClient } from "@/lib/query/hydrate";
import { makeQueryClient } from "@/lib/query/query-client";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Workflow run" };

export default async function WorkflowRunPage({
  params,
}: PageProps<"/w/[workspaceSlug]/workflows/[workflowId]/runs/[runId]">) {
  const { workspaceSlug, workflowId, runId } = await params;
  const { membership } = await requireWorkspaceAccess(workspaceSlug);
  const run = await findWorkflowRunById(membership.workspace.id, workflowId, runId);
  if (!run) notFound();

  const queryClient = makeQueryClient();
  queryClient.setQueryData(workflowKeys.run(workspaceSlug, workflowId, runId), run);

  return (
    <HydrateClient queryClient={queryClient}>
      <WorkflowRunDetail workflowId={workflowId} runId={runId} />
    </HydrateClient>
  );
}
