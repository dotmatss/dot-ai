import type { Metadata } from "next";

import { AgentToolsPanel } from "@/features/agents/components/agent-tools-panel";

export const metadata: Metadata = { title: "Agent tools" };

export default async function AgentToolsPage({ params }: PageProps<"/w/[workspaceSlug]/agents/[agentId]/tools">) {
  const { agentId } = await params;
  return <AgentToolsPanel agentId={agentId} />;
}
