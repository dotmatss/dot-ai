import { revokeApiKey } from "@/features/integrations/server/api-key-service";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; apiKeyId: string };

/**
 * Revokes a key. The row is kept rather than deleted so the audit trail still
 * explains which key was used before it was withdrawn.
 */
export const DELETE = workspaceRoute<Params>(
  async ({ membership, user, params }) => {
    const apiKey = await revokeApiKey({ workspaceId: membership.workspace.id, userId: user.id }, params.apiKeyId);
    return ok(apiKey);
  },
  { minimumRole: "admin" },
);
