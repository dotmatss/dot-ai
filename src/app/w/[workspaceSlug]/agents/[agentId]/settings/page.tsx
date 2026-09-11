import type { Metadata } from "next";

import { AgentSettingsForm } from "@/features/agents/components/agent-settings-form";

export const metadata: Metadata = { title: "Agent settings" };

export default async function AgentSettingsPage({ params }: PageProps<"/w/[workspaceSlug]/agents/[agentId]/settings">) {
  const { agentId } = await params;
  return <AgentSettingsForm agentId={agentId} />;
}
