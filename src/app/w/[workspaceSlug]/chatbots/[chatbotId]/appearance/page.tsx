import type { Metadata } from "next";

import { ChatbotAppearanceForm } from "@/features/chatbots/components/chatbot-appearance-form";

export const metadata: Metadata = { title: "Chatbot appearance" };

export default async function ChatbotAppearancePage({ params }: PageProps<"/w/[workspaceSlug]/chatbots/[chatbotId]/appearance">) {
  const { chatbotId } = await params;
  return <ChatbotAppearanceForm chatbotId={chatbotId} />;
}
