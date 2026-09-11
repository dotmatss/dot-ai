import { conversationListQuerySchema } from "@/features/conversations/schemas";
import { getConversations } from "@/features/conversations/server/conversation-service";
import { parseSearchParams } from "@/server/http/request";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

export const GET = workspaceRoute(async ({ request, membership, user }) => {
  const filters = parseSearchParams(request, conversationListQuerySchema);
  // The "me" assignee filter is resolved against the session, never the query.
  const page = await getConversations(membership.workspace.id, filters, user.id);
  return ok(page);
});
