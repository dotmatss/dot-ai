import type { Metadata } from "next";

import { AgentKnowledgePanel } from "@/features/agents/components/agent-knowledge-panel";

export const metadata: Metadata = { title: "Agent knowledge" };

export default async function AgentKnowledgePage({ params }: PageProps<"/w/[workspaceSlug]/agents/[agentId]/knowledge">) {
  const { agentId } = await params;
  return <AgentKnowledgePanel agentId={agentId} />;
}
