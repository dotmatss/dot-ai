import { playgroundChatSchema } from "@/features/chatbots/schemas";
import { runChatbotChat } from "@/features/chatbots/server/chatbot-chat";
import { getChatbot } from "@/features/chatbots/server/chatbot-service";
import { ApiError } from "@/lib/api/api-error";
import { checkRateLimit } from "@/server/http/rate-limit";
import { parseJsonBody } from "@/server/http/request";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; chatbotId: string };

/** Authenticated playground: lets workspace members test a chatbot in any status. */
export const POST = workspaceRoute<Params>(
  async ({ request, membership, user, params }) => {
    // Even an authenticated member should not be able to drive unbounded model
    // spend from a single session.
    const limit = checkRateLimit(`playground:${membership.workspace.id}:${user.id}`, { limit: 60, windowMs: 60_000 });
    if (!limit.allowed) throw ApiError.rateLimited(`Too many messages. Try again in ${limit.retryAfterSeconds}s.`);

    const input = await parseJsonBody(request, playgroundChatSchema);
    const chatbot = await getChatbot(membership.workspace.id, params.chatbotId);
    return runChatbotChat({
      chatbot,
      input,
      channel: "playground",
      signal: request.signal,
      metadata: { userId: user.id },
    });
  },
  { minimumRole: "member" },
);
