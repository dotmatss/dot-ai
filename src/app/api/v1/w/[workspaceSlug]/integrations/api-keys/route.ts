import { apiKeyListQuerySchema, createApiKeySchema } from "@/features/integrations/schemas";
import { createApiKey, getApiKeys } from "@/features/integrations/server/api-key-service";
import { parseJsonBody, parseSearchParams } from "@/server/http/request";
import { created, ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

export const GET = workspaceRoute(async ({ request, membership }) => {
  const filters = parseSearchParams(request, apiKeyListQuerySchema);
  const page = await getApiKeys(membership.workspace.id, filters);
  return ok(page);
});

/**
 * Mints a key. Admin-only: a key grants API access to the whole workspace, so
 * creating one is a privilege grant, not an ordinary edit.
 *
 * This is the one and only response that carries the plaintext key.
 */
export const POST = workspaceRoute(
  async ({ request, membership, user }) => {
    const input = await parseJsonBody(request, createApiKeySchema);
    const result = await createApiKey({ workspaceId: membership.workspace.id, userId: user.id }, input);
    return created(result);
  },
  { minimumRole: "admin" },
);
