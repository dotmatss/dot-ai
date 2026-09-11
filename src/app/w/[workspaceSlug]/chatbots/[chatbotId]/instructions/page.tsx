import type { Metadata } from "next";

import { ChatbotInstructionsForm } from "@/features/chatbots/components/chatbot-instructions-form";

export const metadata: Metadata = { title: "Chatbot instructions" };

export default async function ChatbotInstructionsPage({ params }: PageProps<"/w/[workspaceSlug]/chatbots/[chatbotId]/instructions">) {
  const { chatbotId } = await params;
  return <ChatbotInstructionsForm chatbotId={chatbotId} />;
}
