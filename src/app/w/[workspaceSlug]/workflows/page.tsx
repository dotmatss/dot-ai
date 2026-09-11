import type { Metadata } from "next";

import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { CreateWorkflowButton } from "@/features/workflows/components/create-workflow-dialog";
import { WorkflowsList } from "@/features/workflows/components/workflows-list";
import { parseWorkflowFilters } from "@/features/workflows/filters";
import { workflowKeys } from "@/features/workflows/queries";
import { getWorkflows } from "@/features/workflows/server/workflow-service";
import { HydrateClient } from "@/lib/query/hydrate";
import { makeQueryClient } from "@/lib/query/query-client";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Workflows" };

export default async function WorkflowsPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/workflows">) {
  const [{ workspaceSlug }, query] = await Promise.all([params, searchParams]);
  const { membership } = await requireWorkspaceAccess(workspaceSlug);
  const filters = parseWorkflowFilters(query);

  const queryClient = makeQueryClient();
  queryClient.setQueryData(workflowKeys.list(workspaceSlug, filters), await getWorkflows(membership.workspace.id, filters));

  return (
    <PageContainer>
      <PageHeader
        title="Workflows"
        description="Automate work with triggers, AI steps, branching logic and tools — and inspect every run."
        actions={<CreateWorkflowButton />}
      />
      <HydrateClient queryClient={queryClient}>
        <WorkflowsList />
      </HydrateClient>
    </PageContainer>
  );
}
