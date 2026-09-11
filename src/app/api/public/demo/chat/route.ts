import type { NextRequest } from "next/server";

import { getServerEnv } from "@/config/env";
import { runDemoChat } from "@/features/public-chatbot/server/demo-chat";
import { demoChatSchema } from "@/features/public-chatbot/schemas";
import { ApiError } from "@/lib/api/api-error";
import { checkRateLimits, clientIpFrom } from "@/server/http/rate-limit";
import { parseJsonBody } from "@/server/http/request";
import { toErrorResponse } from "@/server/http/responses";

/**
 * Public product demo on the marketing site.
 *
 * Unauthenticated by design: it is a demo for anonymous visitors, so there is
 * no credential to present and none is accepted. What makes that safe is that
 * the handler has nothing tenant-scoped to reach - no workspace, no chatbot
 * row, no conversation, no knowledge base. It answers from the published
 * documentation and persists nothing.
 *
 * There is no CSRF check because there is no cookie, no session and no state
 * change: a forged request can only make the attacker's own browser ask the
 * documentation a question. The Origin check below is about cost, not
 * authorization - it keeps the endpoint from being trivially reused as someone
 * else's free AI proxy. It is best effort: a non-browser client can set any
 * Origin, which is why the rate limits, not the header, are the real ceiling.
 */
export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(getServerEnv().APP_URL).origin) {
      throw ApiError.forbidden("Unexpected request origin");
    }

    const ip = clientIpFrom(request.headers);

    // Two ceilings. The global one bounds what this endpoint can ever cost,
    // however many visitors arrive; the per-address one stops a single
    // visitor - or a naive script - from consuming that whole budget. The
    // client address is spoofable, so it is the narrower limit, never the only one.
    const limit = checkRateLimits([
      { key: "public-demo:global", limit: 600, windowMs: 60_000 },
      { key: `public-demo:ip:${ip}`, limit: 12, windowMs: 60_000 },
    ]);
    if (!limit.allowed) {
      throw ApiError.rateLimited(`The demo is busy right now. Try again in ${limit.retryAfterSeconds}s.`);
    }

    const input = await parseJsonBody(request, demoChatSchema);
    return runDemoChat(input, request.signal);
  } catch (error) {
    return toErrorResponse(error);
  }
}
