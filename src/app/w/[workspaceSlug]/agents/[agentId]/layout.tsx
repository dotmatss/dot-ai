import { notFound } from "next/navigation";

import { PageContainer } from "@/components/layout/page-container";
import { AgentHeader } from "@/features/agents/components/agent-header";
import { AgentTabs } from "@/features/agents/components/agent-tabs";
import { agentKeys } from "@/features/agents/queries";
import { findAgentById } from "@/features/agents/server/agent-repository";
import { HydrateClient } from "@/lib/query/hydrate";
import { makeQueryClient } from "@/lib/query/query-client";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export default async function AgentLayout({ children, params }: LayoutProps<"/w/[workspaceSlug]/agents/[agentId]">) {
  const { workspaceSlug, agentId } = await params;
  const { membership } = await requireWorkspaceAccess(workspaceSlug);
  const agent = await findAgentById(membership.workspace.id, agentId);
  if (!agent) notFound();

  const queryClient = makeQueryClient();
  queryClient.setQueryData(agentKeys.detail(workspaceSlug, agentId), agent);

  return (
    <HydrateClient queryClient={queryClient}>
      <PageContainer>
        <AgentHeader agentId={agentId} />
        <AgentTabs agentId={agentId} />
        <div>{children}</div>
      </PageContainer>
    </HydrateClient>
  );
}
