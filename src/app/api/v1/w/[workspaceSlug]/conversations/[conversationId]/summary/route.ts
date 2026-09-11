import { summarizeConversation } from "@/features/conversations/server/conversation-service";
import { ApiError } from "@/lib/api/api-error";
import { checkRateLimits } from "@/server/http/rate-limit";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; conversationId: string };

/**
 * Generates and stores the AI recap. POST because it spends model tokens and
 * writes to the record; the limits below are the spend ceiling, so the
 * server-derived workspace key is checked before the per-user one.
 */
export const POST = workspaceRoute<Params>(
  async ({ request, membership, user, params }) => {
    const limit = checkRateLimits([
      { key: `conversation-summary:workspace:${membership.workspace.id}`, limit: 120, windowMs: 60_000 },
      { key: `conversation-summary:user:${membership.workspace.id}:${user.id}`, limit: 20, windowMs: 60_000 },
    ]);
    if (!limit.allowed) throw ApiError.rateLimited(`Too many summaries. Try again in ${limit.retryAfterSeconds}s.`);

    const conversation = await summarizeConversation(
      { workspaceId: membership.workspace.id, userId: user.id, userName: user.name },
      params.conversationId,
      request.signal,
    );
    return ok(conversation);
  },
  { minimumRole: "member" },
);
