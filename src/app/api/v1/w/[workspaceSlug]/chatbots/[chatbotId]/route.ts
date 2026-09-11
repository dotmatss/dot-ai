import { updateChatbotSchema } from "@/features/chatbots/schemas";
import { deleteChatbot, getChatbot, updateChatbot } from "@/features/chatbots/server/chatbot-service";
import { parseJsonBody } from "@/server/http/request";
import { noContent, ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; chatbotId: string };

export const GET = workspaceRoute<Params>(async ({ membership, params }) => {
  const chatbot = await getChatbot(membership.workspace.id, params.chatbotId);
  return ok(chatbot);
});

export const PATCH = workspaceRoute<Params>(
  async ({ request, membership, user, params }) => {
    const input = await parseJsonBody(request, updateChatbotSchema);
    const chatbot = await updateChatbot({ workspaceId: membership.workspace.id, userId: user.id }, params.chatbotId, input);
    return ok(chatbot);
  },
  { minimumRole: "member" },
);

export const DELETE = workspaceRoute<Params>(
  async ({ membership, user, params }) => {
    await deleteChatbot({ workspaceId: membership.workspace.id, userId: user.id }, params.chatbotId);
    return noContent();
  },
  { minimumRole: "admin" },
);
