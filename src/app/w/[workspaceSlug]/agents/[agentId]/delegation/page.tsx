import type { Metadata } from "next";

import { AgentDelegationPanel } from "@/features/agents/components/agent-delegation-panel";

export const metadata: Metadata = { title: "Agent delegation" };

export default async function AgentDelegationPage({ params }: PageProps<"/w/[workspaceSlug]/agents/[agentId]/delegation">) {
  const { agentId } = await params;
  return <AgentDelegationPanel agentId={agentId} />;
}
