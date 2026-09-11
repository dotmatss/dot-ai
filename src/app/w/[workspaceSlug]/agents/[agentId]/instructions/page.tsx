import type { Metadata } from "next";

import { AgentInstructionsForm } from "@/features/agents/components/agent-instructions-form";

export const metadata: Metadata = { title: "Agent instructions" };

export default async function AgentInstructionsPage({ params }: PageProps<"/w/[workspaceSlug]/agents/[agentId]/instructions">) {
  const { agentId } = await params;
  return <AgentInstructionsForm agentId={agentId} />;
}
