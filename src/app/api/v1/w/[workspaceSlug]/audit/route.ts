import { auditListQuerySchema } from "@/features/audit/schemas";
import { getAuditLog } from "@/features/audit/server/audit-service";
import { parseSearchParams } from "@/server/http/request";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

/**
 * The audit log.
 *
 * `admin`, unlike almost every other list in the app: the log is a record of
 * who did what, across every feature, and reading it is an oversight power
 * rather than an ordinary read. The dashboard's activity card shows the same
 * rows to everyone, but only the last handful and with no way to search them.
 */
export const GET = workspaceRoute(
  async ({ request, membership }) => {
    const filters = parseSearchParams(request, auditListQuerySchema);
    return ok(await getAuditLog(membership.workspace.id, filters));
  },
  { minimumRole: "admin" },
);
