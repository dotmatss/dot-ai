import type { Metadata } from "next";

import { AuditLogTable } from "@/features/audit/components/audit-log-table";
import { parseAuditFilters } from "@/features/audit/filters";
import { auditKeys } from "@/features/audit/queries";
import { getAuditFacets, getAuditLog } from "@/features/audit/server/audit-service";
import { HydrateClient } from "@/lib/query/hydrate";
import { makeQueryClient } from "@/lib/query/query-client";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Audit log" };

export default async function SettingsAuditPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/settings/audit">) {
  const { workspaceSlug } = await params;
  // Admin: reading who did what across the workspace is oversight, not an
  // ordinary list. The API handler enforces the same floor.
  const ctx = await requireWorkspaceAccess(workspaceSlug, "admin");

  const filters = parseAuditFilters(await searchParams);
  const queryClient = makeQueryClient();
  const [entries, facets] = await Promise.all([
    getAuditLog(ctx.membership.workspace.id, filters),
    getAuditFacets(ctx.membership.workspace.id),
  ]);
  queryClient.setQueryData(auditKeys.list(workspaceSlug, filters), entries);
  queryClient.setQueryData(auditKeys.facets(workspaceSlug), facets);

  return (
    <HydrateClient queryClient={queryClient}>
      <AuditLogTable />
    </HydrateClient>
  );
}
