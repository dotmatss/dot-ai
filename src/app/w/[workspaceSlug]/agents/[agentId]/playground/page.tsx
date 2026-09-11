import type { Metadata } from "next";

import { AgentPlayground } from "@/features/agents/components/agent-playground";

export const metadata: Metadata = { title: "Agent playground" };

export default async function AgentPlaygroundPage({ params }: PageProps<"/w/[workspaceSlug]/agents/[agentId]/playground">) {
  const { agentId } = await params;
  return <AgentPlayground agentId={agentId} />;
}
