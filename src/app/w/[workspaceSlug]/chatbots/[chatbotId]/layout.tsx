import { notFound } from "next/navigation";

import { PageContainer } from "@/components/layout/page-container";
import { ChatbotHeader } from "@/features/chatbots/components/chatbot-header";
import { ChatbotTabs } from "@/features/chatbots/components/chatbot-tabs";
import { chatbotKeys } from "@/features/chatbots/queries";
import { findChatbotById } from "@/features/chatbots/server/chatbot-repository";
import { HydrateClient } from "@/lib/query/hydrate";
import { makeQueryClient } from "@/lib/query/query-client";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export default async function ChatbotLayout({ children, params }: LayoutProps<"/w/[workspaceSlug]/chatbots/[chatbotId]">) {
  const { workspaceSlug, chatbotId } = await params;
  const { membership } = await requireWorkspaceAccess(workspaceSlug);
  const chatbot = await findChatbotById(membership.workspace.id, chatbotId);
  if (!chatbot) notFound();

  const queryClient = makeQueryClient();
  queryClient.setQueryData(chatbotKeys.detail(workspaceSlug, chatbotId), chatbot);

  return (
    <HydrateClient queryClient={queryClient}>
      <PageContainer>
        <ChatbotHeader chatbotId={chatbotId} />
        <ChatbotTabs chatbotId={chatbotId} />
        <div>{children}</div>
      </PageContainer>
    </HydrateClient>
  );
}
