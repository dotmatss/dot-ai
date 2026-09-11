import type { Metadata } from "next";

import { WorkflowBuilder } from "@/features/workflows/components/workflow-builder";

export const metadata: Metadata = { title: "Workflow builder" };

export default async function WorkflowBuilderPage({ params }: PageProps<"/w/[workspaceSlug]/workflows/[workflowId]">) {
  const { workflowId } = await params;
  return <WorkflowBuilder workflowId={workflowId} />;
}
