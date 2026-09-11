import type { Metadata } from "next";

import { AgentMemoryOutputForm } from "@/features/agents/components/agent-memory-output-form";

export const metadata: Metadata = { title: "Agent memory & output" };

export default async function AgentMemoryPage({ params }: PageProps<"/w/[workspaceSlug]/agents/[agentId]/memory">) {
  const { agentId } = await params;
  return <AgentMemoryOutputForm agentId={agentId} />;
}
