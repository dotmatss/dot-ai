import type { Metadata } from "next";

import { AgentMcpToolsPanel } from "@/features/agents/components/agent-mcp-tools-panel";
import { AgentToolsPanel } from "@/features/agents/components/agent-tools-panel";

export const metadata: Metadata = { title: "Agent tools" };

/**
 * Two panels, deliberately separate.
 *
 * Built-in tools are configured here and are simulated when called. MCP tools
 * are *selected* from what the workspace has already approved, and they really
 * run. Presenting them as one list would hide that difference.
 */
export default async function AgentToolsPage({ params }: PageProps<"/w/[workspaceSlug]/agents/[agentId]/tools">) {
  const { agentId } = await params;
  return (
    <div className="flex flex-col gap-6">
      <AgentToolsPanel agentId={agentId} />
      <AgentMcpToolsPanel agentId={agentId} />
    </div>
  );
}
