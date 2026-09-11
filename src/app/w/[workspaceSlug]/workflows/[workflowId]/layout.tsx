import { notFound } from "next/navigation";

import { PageContainer } from "@/components/layout/page-container";
import { WorkflowHeader } from "@/features/workflows/components/workflow-header";
import { WorkflowTabs } from "@/features/workflows/components/workflow-tabs";
import { workflowKeys } from "@/features/workflows/queries";
import { findWorkflowById } from "@/features/workflows/server/workflow-repository";
import { HydrateClient } from "@/lib/query/hydrate";
import { makeQueryClient } from "@/lib/query/query-client";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export default async function WorkflowLayout({ children, params }: LayoutProps<"/w/[workspaceSlug]/workflows/[workflowId]">) {
  const { workspaceSlug, workflowId } = await params;
  const { membership } = await requireWorkspaceAccess(workspaceSlug);
  const workflow = await findWorkflowById(membership.workspace.id, workflowId);
  if (!workflow) notFound();

  const queryClient = makeQueryClient();
  queryClient.setQueryData(workflowKeys.detail(workspaceSlug, workflowId), workflow);

  return (
    <HydrateClient queryClient={queryClient}>
      <PageContainer width="wide">
        <WorkflowHeader workflowId={workflowId} />
        <WorkflowTabs workflowId={workflowId} />
        <div>{children}</div>
      </PageContainer>
    </HydrateClient>
  );
}
