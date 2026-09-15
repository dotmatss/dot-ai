import { getOverview } from "@/features/intelligence/server/intelligence-repository";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

export const GET = workspaceRoute(async ({ membership }) => {
  const overview = await getOverview(membership.workspace.id);
  return ok(overview);
});
