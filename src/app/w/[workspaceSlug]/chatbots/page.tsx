import type { Metadata } from "next";

import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { ChatbotsList } from "@/features/chatbots/components/chatbots-list";
import { CreateChatbotButton } from "@/features/chatbots/components/create-chatbot-dialog";
import { parseChatbotFilters } from "@/features/chatbots/filters";
import { chatbotKeys } from "@/features/chatbots/queries";
import { getChatbots } from "@/features/chatbots/server/chatbot-service";
import { HydrateClient } from "@/lib/query/hydrate";
import { makeQueryClient } from "@/lib/query/query-client";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Chatbots" };

export default async function ChatbotsPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/chatbots">) {
  const [{ workspaceSlug }, query] = await Promise.all([params, searchParams]);
  const { membership } = await requireWorkspaceAccess(workspaceSlug);
  const filters = parseChatbotFilters(query);

  const queryClient = makeQueryClient();
  queryClient.setQueryData(chatbotKeys.list(workspaceSlug, filters), await getChatbots(membership.workspace.id, filters));

  return (
    <PageContainer>
      <PageHeader
        title="Chatbots"
        description="Create AI chatbots, connect knowledge and deploy them to your websites."
        actions={<CreateChatbotButton />}
      />
      <HydrateClient queryClient={queryClient}>
        <ChatbotsList />
      </HydrateClient>
    </PageContainer>
  );
}
