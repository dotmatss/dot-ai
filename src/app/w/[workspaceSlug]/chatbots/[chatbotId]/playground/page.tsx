import type { Metadata } from "next";

import { ChatbotPlayground } from "@/features/chatbots/components/chatbot-playground";

export const metadata: Metadata = { title: "Chatbot playground" };

export default async function ChatbotPlaygroundPage({ params }: PageProps<"/w/[workspaceSlug]/chatbots/[chatbotId]/playground">) {
  const { chatbotId } = await params;
  return <ChatbotPlayground chatbotId={chatbotId} />;
}
