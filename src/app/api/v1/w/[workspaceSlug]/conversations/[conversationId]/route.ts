import { updateConversationSchema } from "@/features/conversations/schemas";
import { getConversationDetail, updateConversation } from "@/features/conversations/server/conversation-service";
import { parseJsonBody } from "@/server/http/request";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; conversationId: string };

export const GET = workspaceRoute<Params>(async ({ membership, params }) => {
  const detail = await getConversationDetail(membership.workspace.id, params.conversationId);
  return ok(detail);
});

/** Status, assignment and contact linking. Triage is ordinary member work. */
export const PATCH = workspaceRoute<Params>(
  async ({ request, membership, user, params }) => {
    const input = await parseJsonBody(request, updateConversationSchema);
    const conversation = await updateConversation(
      { workspaceId: membership.workspace.id, userId: user.id, userName: user.name },
      params.conversationId,
      input,
    );
    return ok(conversation);
  },
  { minimumRole: "member" },
);
