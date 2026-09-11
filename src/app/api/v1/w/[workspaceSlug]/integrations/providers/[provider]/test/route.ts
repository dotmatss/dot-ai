import { isIntegrationProvider } from "@/features/integrations/registry";
import { testIntegration } from "@/features/integrations/server/integration-service";
import { ApiError } from "@/lib/api/api-error";
import { checkRateLimit } from "@/server/http/rate-limit";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; provider: string };

/**
 * Sends a test payload from the server.
 *
 * This route makes an outbound request to an address the workspace chose, so it
 * is rate limited per workspace as well as authorized: without a ceiling it
 * would be a convenient amplifier and port scanner, even with the SSRF checks
 * in `connection-test.ts` rejecting private destinations.
 */
export const POST = workspaceRoute<Params>(
  async ({ membership, user, params }) => {
    if (!isIntegrationProvider(params.provider)) throw ApiError.notFound("Unknown integration");

    const limit = checkRateLimit(`integration-test:${membership.workspace.id}`, { limit: 20, windowMs: 60_000 });
    if (!limit.allowed) throw ApiError.rateLimited(`Too many connection tests. Try again in ${limit.retryAfterSeconds}s.`);

    const result = await testIntegration({ workspaceId: membership.workspace.id, userId: user.id }, params.provider);
    return ok(result);
  },
  { minimumRole: "member" },
);
