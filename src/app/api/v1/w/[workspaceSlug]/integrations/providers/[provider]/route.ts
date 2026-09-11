import { isIntegrationProvider } from "@/features/integrations/registry";
import { connectIntegrationSchema } from "@/features/integrations/schemas";
import { connectIntegration, disconnectIntegration } from "@/features/integrations/server/integration-service";
import type { IntegrationProvider } from "@/features/integrations/types";
import { ApiError } from "@/lib/api/api-error";
import { parseJsonBody } from "@/server/http/request";
import { noContent, ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; provider: string };

/** Path parameters are strings from the network; only registry providers pass. */
function requireProvider(value: string): IntegrationProvider {
  if (!isIntegrationProvider(value)) throw ApiError.notFound("Unknown integration");
  return value;
}

/** Connect or reconfigure. Idempotent: one connection per provider per workspace. */
export const PUT = workspaceRoute<Params>(
  async ({ request, membership, user, params }) => {
    const provider = requireProvider(params.provider);
    const input = await parseJsonBody(request, connectIntegrationSchema);
    const integration = await connectIntegration({ workspaceId: membership.workspace.id, userId: user.id }, provider, input);
    return ok(integration);
  },
  { minimumRole: "member" },
);

/** Destroys the stored credentials, so it is an administrative action. */
export const DELETE = workspaceRoute<Params>(
  async ({ membership, user, params }) => {
    const provider = requireProvider(params.provider);
    await disconnectIntegration({ workspaceId: membership.workspace.id, userId: user.id }, provider);
    return noContent();
  },
  { minimumRole: "admin" },
);
