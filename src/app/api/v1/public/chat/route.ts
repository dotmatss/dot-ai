import type { NextRequest } from "next/server";

import { runChatbotChat } from "@/features/chatbots/server/chatbot-chat";
import { findChatbotById } from "@/features/chatbots/server/chatbot-repository";
import { publicChatSchema } from "@/features/developer/schemas";
import { authenticateApiKey } from "@/features/developer/server/api-key-auth";
import { ApiError } from "@/lib/api/api-error";
import { checkRateLimits } from "@/server/http/rate-limit";
import { parseJsonBody } from "@/server/http/request";
import { toErrorResponse } from "@/server/http/responses";

/**
 * Public chat API for server-to-server callers.
 *
 * Authentication is an `Authorization: Bearer dot_live_…` API key, which is
 * also where the workspace comes from - the caller never names a tenant. There
 * is no origin or CSRF check because there is no cookie to ride: an attacker
 * who can set an Authorization header already has the credential.
 *
 * The response is the same SSE stream the widget and the playground consume,
 * so a third-party client and our own widget share one contract.
 */
export async function POST(request: NextRequest) {
  try {
    const identity = await authenticateApiKey(request);
    if (!identity) {
      throw ApiError.unauthorized("Provide a valid workspace API key as `Authorization: Bearer dot_live_…`");
    }

    // Both keys are server-derived, so they actually bound spend: a caller
    // cannot rotate them the way it can rotate a spoofed client address. The
    // workspace ceiling comes first so one key cannot escape it by being new.
    const limit = checkRateLimits([
      { key: `public-api:workspace:${identity.workspaceId}`, limit: 600, windowMs: 60_000 },
      { key: `public-api:key:${identity.apiKeyId}`, limit: 120, windowMs: 60_000 },
    ]);
    if (!limit.allowed) {
      throw ApiError.rateLimited(`Rate limit exceeded. Retry in ${limit.retryAfterSeconds}s.`);
    }

    const input = await parseJsonBody(request, publicChatSchema);

    // Scoped to the authenticated workspace, so an id belonging to another
    // tenant is indistinguishable from one that does not exist.
    const chatbot = await findChatbotById(identity.workspaceId, input.chatbotId);
    if (!chatbot) throw ApiError.notFound("Chatbot not found");
    if (chatbot.status !== "active") throw ApiError.forbidden("This chatbot is not active");

    return await runChatbotChat({
      chatbot,
      input: { conversationId: input.conversationId, messages: input.messages },
      channel: "api",
      signal: request.signal,
      metadata: { apiKeyId: identity.apiKeyId },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
