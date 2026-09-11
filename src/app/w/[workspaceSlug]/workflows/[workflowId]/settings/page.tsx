import type { Metadata } from "next";

import { WorkflowSettingsForm } from "@/features/workflows/components/workflow-settings-form";

export const metadata: Metadata = { title: "Workflow settings" };

export default async function WorkflowSettingsPage({ params }: PageProps<"/w/[workspaceSlug]/workflows/[workflowId]/settings">) {
  const { workflowId } = await params;
  return <WorkflowSettingsForm workflowId={workflowId} />;
}
