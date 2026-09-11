import type { Metadata } from "next";

import { getServerEnv } from "@/config/env";
import { ChatbotDeployPanel } from "@/features/chatbots/components/chatbot-deploy-panel";

export const metadata: Metadata = { title: "Deploy chatbot" };

export default async function ChatbotDeployPage({ params }: PageProps<"/w/[workspaceSlug]/chatbots/[chatbotId]/deploy">) {
  const { chatbotId } = await params;
  const origin = getServerEnv().APP_URL.replace(/\/$/, "");
  return <ChatbotDeployPanel chatbotId={chatbotId} origin={origin} />;
}
