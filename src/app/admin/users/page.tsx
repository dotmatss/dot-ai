import { AppBadge } from "@/components/ui/app-badge";
import { LifecycleControl } from "@/features/platform/components/lifecycle-control";
import { PlatformFilter, PlatformList } from "@/features/platform/components/platform-list";
import { parseUserFilters } from "@/features/platform/filters";
import { listUsers } from "@/features/platform/server/platform-repository";
import { requirePlatformAccess } from "@/server/auth/platform-dal";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePlatformAccess();
  const filters = parseUserFilters(await searchParams);
  const data = await listUsers(filters);

  return (
    <PlatformList
      title="Users"
      description="Platform accounts. Disabling ends every live session; it never deletes the account or its work."
      path="/admin/users"
      filters={{ ...filters }}
      {...data}
      columns={["Name", "Email", "Status", "Organizations", "Access"]}
      rows={data.items.map((row) => ({
        id: row.id,
        cells: [
          <div key="name" className="flex items-center gap-2">
            <span className="font-medium">{row.name}</span>
            {row.isPlatformAdmin ? (
              <AppBadge tone="warning" variant="outline" size="sm">
                Operator
              </AppBadge>
            ) : null}
          </div>,
          <span key="email" className="text-foreground-secondary">
            {row.email}
          </span>,
          <div key="status" className="flex flex-col items-start gap-1">
            <AppBadge tone={row.disabledAt ? "danger" : "success"} size="sm">
              {row.disabledAt ? "Disabled" : "Active"}
            </AppBadge>
            {row.disabledReason ? (
              <span className="max-w-60 truncate text-xs text-foreground-muted" title={row.disabledReason}>
                {row.disabledReason}
              </span>
            ) : null}
          </div>,
          row.organizationCount,
          // A platform admin cannot be disabled from here at all - the service
          // refuses it, so offering the control would be a button that fails.
          // Removing a peer's access is an out-of-band act by design.
          row.isPlatformAdmin ? (
            <span key="access" className="text-xs text-foreground-muted">
              Managed out of band
            </span>
          ) : (
            <LifecycleControl
              key="access"
              kind="users"
              id={row.id}
              label={row.email}
              current={row.disabledAt ? "disabled" : "active"}
            />
          ),
        ],
      }))}
      extraFilters={<PlatformFilter name="state" value={filters.state} options={["active", "disabled"]} />}
    />
  );
}
