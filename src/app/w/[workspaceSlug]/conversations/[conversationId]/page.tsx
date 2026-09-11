import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageContainer } from "@/components/layout/page-container";
import { CONVERSATION_DETAIL_MESSAGE_LIMIT } from "@/features/conversations/constants";
import { ConversationDetailView } from "@/features/conversations/components/conversation-detail";
import { conversationKeys } from "@/features/conversations/queries";
import {
  findConversationDetail,
  listConversationMessages,
} from "@/features/conversations/server/conversation-repository";
import { HydrateClient } from "@/lib/query/hydrate";
import { makeQueryClient } from "@/lib/query/query-client";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Conversation" };

export default async function ConversationDetailPage({ params }: PageProps<"/w/[workspaceSlug]/conversations/[conversationId]">) {
  const { workspaceSlug, conversationId } = await params;
  const { membership } = await requireWorkspaceAccess(workspaceSlug);

  // Repository rather than the service: a missing row is a 404 page here, not
  // an API error envelope.
  const conversation = await findConversationDetail(membership.workspace.id, conversationId);
  if (!conversation) notFound();
  const messages = await listConversationMessages(membership.workspace.id, conversationId, CONVERSATION_DETAIL_MESSAGE_LIMIT);

  const queryClient = makeQueryClient();
  queryClient.setQueryData(conversationKeys.detail(workspaceSlug, conversationId), { conversation, messages });

  return (
    <PageContainer>
      <HydrateClient queryClient={queryClient}>
        <ConversationDetailView conversationId={conversationId} />
      </HydrateClient>
    </PageContainer>
  );
}
