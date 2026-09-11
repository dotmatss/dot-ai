import type { Metadata } from "next";

import { ChatbotSettingsForm } from "@/features/chatbots/components/chatbot-settings-form";

export const metadata: Metadata = { title: "Chatbot settings" };

export default async function ChatbotSettingsPage({ params }: PageProps<"/w/[workspaceSlug]/chatbots/[chatbotId]/settings">) {
  const { chatbotId } = await params;
  return <ChatbotSettingsForm chatbotId={chatbotId} />;
}
