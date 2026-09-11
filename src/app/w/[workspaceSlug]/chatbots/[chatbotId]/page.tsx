import type { Metadata } from "next";

import { ChatbotOverview } from "@/features/chatbots/components/chatbot-overview";

export const metadata: Metadata = { title: "Chatbot overview" };

export default async function ChatbotOverviewPage({ params }: PageProps<"/w/[workspaceSlug]/chatbots/[chatbotId]">) {
  const { chatbotId } = await params;
  return <ChatbotOverview chatbotId={chatbotId} />;
}
