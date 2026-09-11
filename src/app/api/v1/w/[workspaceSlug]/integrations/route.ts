import { getIntegrations } from "@/features/integrations/server/integration-service";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

/**
 * Connections for this workspace. The catalogue itself (names, descriptions,
 * icons, schemas) is a client-importable registry, so only the rows travel.
 * No response from this module ever contains a secret value.
 */
export const GET = workspaceRoute(async ({ membership }) => {
  const integrations = await getIntegrations(membership.workspace.id);
  return ok(integrations);
});
