import { getChatbot, getChatbotKnowledgeOptions } from "@/features/chatbots/server/chatbot-service";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; chatbotId: string };

export const GET = workspaceRoute<Params>(async ({ membership, params }) => {
  await getChatbot(membership.workspace.id, params.chatbotId);
  const options = await getChatbotKnowledgeOptions(membership.workspace.id, params.chatbotId);
  return ok(options);
});
