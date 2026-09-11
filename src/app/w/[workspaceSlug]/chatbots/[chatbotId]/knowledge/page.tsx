import type { Metadata } from "next";

import { ChatbotKnowledgePanel } from "@/features/chatbots/components/chatbot-knowledge-panel";

export const metadata: Metadata = { title: "Chatbot knowledge" };

export default async function ChatbotKnowledgePage({ params }: PageProps<"/w/[workspaceSlug]/chatbots/[chatbotId]/knowledge">) {
  const { chatbotId } = await params;
  return <ChatbotKnowledgePanel chatbotId={chatbotId} />;
}
