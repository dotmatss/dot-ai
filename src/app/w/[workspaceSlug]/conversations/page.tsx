import type { Metadata } from "next";

import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { ConversationsTable } from "@/features/conversations/components/conversations-table";
import { parseConversationFilters } from "@/features/conversations/filters";
import { conversationKeys } from "@/features/conversations/queries";
import { getConversations } from "@/features/conversations/server/conversation-service";
import { HydrateClient } from "@/lib/query/hydrate";
import { makeQueryClient } from "@/lib/query/query-client";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Conversations" };

export default async function ConversationsPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/conversations">) {
  const [{ workspaceSlug }, query] = await Promise.all([params, searchParams]);
  const { membership, user } = await requireWorkspaceAccess(workspaceSlug);
  const filters = parseConversationFilters(query);

  const queryClient = makeQueryClient();
  // Same normalizer as the client, so the seeded key is the one it reads.
  queryClient.setQueryData(
    conversationKeys.list(workspaceSlug, filters),
    await getConversations(membership.workspace.id, filters, user.id),
  );

  return (
    <PageContainer>
      <PageHeader
        title="Conversations"
        description="Every chat your chatbots, agents and API have handled, with the thread, the contact and the outcome."
      />
      <HydrateClient queryClient={queryClient}>
        <ConversationsTable />
      </HydrateClient>
    </PageContainer>
  );
}
