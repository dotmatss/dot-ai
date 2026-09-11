import type { NextRequest } from "next/server";
import { z } from "zod";

import { getServerEnv } from "@/config/env";
import { playgroundChatSchema } from "@/features/chatbots/schemas";
import { runChatbotChat } from "@/features/chatbots/server/chatbot-chat";
import { findChatbotByEmbedKey } from "@/features/chatbots/server/chatbot-repository";
import { isOriginAllowed } from "@/features/embed/server/domain-match";
import { verifyEmbedToken } from "@/features/embed/server/embed-token";
import { ApiError } from "@/lib/api/api-error";
import { checkRateLimits, clientIpFrom } from "@/server/http/rate-limit";
import { parseJsonBody } from "@/server/http/request";
import { toErrorResponse } from "@/server/http/responses";

const publicChatSchema = playgroundChatSchema.extend({
  embedKey: z.string().min(8).max(64),
  token: z.string().min(16).max(2048),
});

/**
 * Public widget endpoint. Unauthenticated by design; access is gated by the
 * signed embed token (bound to chatbot + validated parent origin), chatbot
 * status, the allowed-domain list and per-IP rate limits.
 */
export async function POST(request: NextRequest) {
  try {
    const ip = clientIpFrom(request.headers);
    const input = await parseJsonBody(request, publicChatSchema);

    const token = verifyEmbedToken(input.token);
    if (!token || token.embedKey !== input.embedKey) throw ApiError.forbidden("Invalid or expired widget session");

    const chatbot = await findChatbotByEmbedKey(input.embedKey);
    if (!chatbot) throw ApiError.notFound("Chatbot not found");

    // The widget runs in an iframe served from this app, so a browser sends
    // this origin. A mismatch means the call did not come from the widget.
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(getServerEnv().APP_URL).origin) {
      throw ApiError.forbidden("Unexpected request origin");
    }

    if (!token.preview) {
      if (chatbot.status !== "active") throw ApiError.forbidden("This chatbot is not active");
      if (!isOriginAllowed(token.origin, chatbot.allowedDomains)) throw ApiError.forbidden("This website is not allowed to use the chatbot");
    }

    // The workspace and chatbot ceilings are the ones that actually bound AI
    // spend: they are keyed on server-resolved ids, so a caller rotating a
    // spoofed client address cannot escape them. The per-address limit only
    // keeps one ordinary visitor from monopolising that budget.
    const limit = checkRateLimits([
      { key: `public-chat:workspace:${chatbot.workspaceId}`, limit: 600, windowMs: 60_000 },
      { key: `public-chat:bot:${chatbot.id}`, limit: 300, windowMs: 60_000 },
      { key: `public-chat:bot:${chatbot.id}:ip:${ip}`, limit: 30, windowMs: 60_000 },
    ]);
    if (!limit.allowed) throw ApiError.rateLimited();

    return await runChatbotChat({
      chatbot,
      input: { conversationId: input.conversationId, messages: input.messages },
      channel: "widget",
      signal: request.signal,
      metadata: { origin: token.origin },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
