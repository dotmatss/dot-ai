import type { Metadata } from "next";

import { AgentOverview } from "@/features/agents/components/agent-overview";

export const metadata: Metadata = { title: "Agent overview" };

export default async function AgentOverviewPage({ params }: PageProps<"/w/[workspaceSlug]/agents/[agentId]">) {
  const { agentId } = await params;
  return <AgentOverview agentId={agentId} />;
}
