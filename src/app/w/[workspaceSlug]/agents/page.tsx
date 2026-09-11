import type { Metadata } from "next";

import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { AgentsList } from "@/features/agents/components/agents-list";
import { CreateAgentButton } from "@/features/agents/components/create-agent-dialog";
import { parseAgentFilters } from "@/features/agents/filters";
import { agentKeys } from "@/features/agents/queries";
import { getAgents } from "@/features/agents/server/agent-service";
import { HydrateClient } from "@/lib/query/hydrate";
import { makeQueryClient } from "@/lib/query/query-client";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Agents" };

export default async function AgentsPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/agents">) {
  const [{ workspaceSlug }, query] = await Promise.all([params, searchParams]);
  const { membership } = await requireWorkspaceAccess(workspaceSlug);
  const filters = parseAgentFilters(query);

  const queryClient = makeQueryClient();
  queryClient.setQueryData(agentKeys.list(workspaceSlug, filters), await getAgents(membership.workspace.id, filters));

  return (
    <PageContainer>
      <PageHeader
        title="Agents"
        description="Agents follow your instructions, use tools, read your knowledge and pause for approval before they act."
        actions={<CreateAgentButton />}
      />
      <HydrateClient queryClient={queryClient}>
        <AgentsList />
      </HydrateClient>
    </PageContainer>
  );
}
