import { chatbotListQuerySchema, createChatbotSchema } from "@/features/chatbots/schemas";
import { createChatbot, getChatbots } from "@/features/chatbots/server/chatbot-service";
import { parseJsonBody, parseSearchParams } from "@/server/http/request";
import { created, ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

export const GET = workspaceRoute(async ({ request, membership }) => {
  const filters = parseSearchParams(request, chatbotListQuerySchema);
  const page = await getChatbots(membership.workspace.id, filters);
  return ok(page);
});

export const POST = workspaceRoute(
  async ({ request, membership, user }) => {
    const input = await parseJsonBody(request, createChatbotSchema);
    const chatbot = await createChatbot({ workspaceId: membership.workspace.id, userId: user.id }, input);
    return created(chatbot);
  },
  { minimumRole: "member" },
);
