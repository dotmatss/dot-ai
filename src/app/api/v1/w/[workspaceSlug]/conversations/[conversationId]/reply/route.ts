import { humanReplySchema } from "@/features/conversations/schemas";
import { replyToConversation } from "@/features/conversations/server/conversation-service";
import { parseJsonBody } from "@/server/http/request";
import { created } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; conversationId: string };

/** Appends a team member's reply to the thread, attributed to the caller. */
export const POST = workspaceRoute<Params>(
  async ({ request, membership, user, params }) => {
    const input = await parseJsonBody(request, humanReplySchema);
    const result = await replyToConversation(
      { workspaceId: membership.workspace.id, userId: user.id, userName: user.name },
      params.conversationId,
      input,
    );
    return created(result);
  },
  { minimumRole: "member" },
);
