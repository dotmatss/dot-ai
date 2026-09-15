import { AppBadge } from "@/components/ui/app-badge";
import { LifecycleControl } from "@/features/platform/components/lifecycle-control";
import { PlatformFilter, PlatformList } from "@/features/platform/components/platform-list";
import { ORGANIZATION_STATUS_META } from "@/features/platform/constants";
import { parseOrganizationFilters } from "@/features/platform/filters";
import { listOrganizations } from "@/features/platform/server/platform-repository";
import { ORGANIZATION_STATUSES } from "@/features/platform/types";
import { requirePlatformAccess } from "@/server/auth/platform-dal";

/**
 * Tenant list for the platform plane.
 *
 * Re-authorizes rather than relying on the layout, which does not re-run on
 * every navigation and cannot protect anything on its own.
 */
export default async function AdminOrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePlatformAccess();
  const filters = parseOrganizationFilters(await searchParams);
  const data = await listOrganizations(filters);

  return (
    <PlatformList
      title="Organizations"
      description="Every tenant on the platform. Suspending closes access without deleting anything."
      path="/admin/organizations"
      filters={{ ...filters }}
      {...data}
      columns={["Organization", "Status", "Workspaces", "Members", "Access"]}
      rows={data.items.map((row) => ({
        id: row.id,
        cells: [
          <div key="name" className="flex flex-col">
            <span className="font-medium">{row.name}</span>
            <span className="text-xs text-foreground-muted">{row.slug}</span>
          </div>,
          <div key="status" className="flex flex-col items-start gap-1">
            <AppBadge tone={ORGANIZATION_STATUS_META[row.status].tone} size="sm">
              {ORGANIZATION_STATUS_META[row.status].label}
            </AppBadge>
            {/* The reason is the answer to "why is this tenant closed", which is
                the question an operator actually arrives with. */}
            {row.statusReason ? (
              <span className="max-w-60 truncate text-xs text-foreground-muted" title={row.statusReason}>
                {row.statusReason}
              </span>
            ) : null}
          </div>,
          row.workspaceCount,
          row.memberCount,
          <LifecycleControl key="access" kind="organizations" id={row.id} label={row.name} current={row.status} />,
        ],
      }))}
      extraFilters={<PlatformFilter name="status" value={filters.status} options={[...ORGANIZATION_STATUSES]} />}
    />
  );
}
