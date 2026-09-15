import { getAuditFacets } from "@/features/audit/server/audit-service";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

/**
 * The values present in this workspace's log, for the filter controls. Admin
 * for the same reason as the log itself: the list of actors and actions is a
 * summary of it.
 */
export const GET = workspaceRoute(
  async ({ membership }) => ok(await getAuditFacets(membership.workspace.id)),
  { minimumRole: "admin" },
);
