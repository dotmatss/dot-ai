import { AppBadge } from "@/components/ui/app-badge";
import { AppInput } from "@/components/ui/app-input";
import { PlatformFilter, PlatformList } from "@/features/platform/components/platform-list";
import { AUDIT_RESULT_META } from "@/features/platform/constants";
import { parsePlatformAuditFilters } from "@/features/platform/filters";
import { listPlatformAudit } from "@/features/platform/server/platform-repository";
import { formatDateTime } from "@/lib/format/date";
import { requirePlatformAccess } from "@/server/auth/platform-dal";

/**
 * The platform audit trail.
 *
 * A Server Component, so `formatDateTime` is called directly - the hydration
 * hazard the conventions warn about applies to timestamps computed during a
 * Client Component's render, not here.
 *
 * `actorEmail` is shown rather than `actorName` because the column is
 * denormalized onto the audit row and therefore survives the deletion of the
 * account that acted; the joined name does not.
 */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePlatformAccess();
  const filters = parsePlatformAuditFilters(await searchParams);
  const data = await listPlatformAudit(filters);

  return (
    <PlatformList
      title="Audit logs"
      description="Privileged actions on the platform plane, including refused attempts. Append-only; never contains a credential."
      path="/admin/audit"
      filters={{ ...filters }}
      {...data}
      columns={["Time", "Actor", "Action", "Target", "Result"]}
      rows={data.items.map((row) => ({
        id: row.id,
        cells: [
          <span key="time" className="whitespace-nowrap tabular-nums text-foreground-secondary">
            {formatDateTime(row.createdAt)}
          </span>,
          <span key="actor" className="text-foreground-secondary">
            {row.actorEmail ?? row.actorName ?? "System"}
          </span>,
          <code key="action" className="text-xs">
            {row.action}
          </code>,
          <span key="target" className="max-w-72 truncate" title={row.targetLabel ?? row.targetType}>
            {row.targetLabel ?? row.targetType}
          </span>,
          <AppBadge key="result" tone={AUDIT_RESULT_META[row.result].tone} size="sm">
            {AUDIT_RESULT_META[row.result].label}
          </AppBadge>,
        ],
      }))}
      extraFilters={
        <>
          <PlatformFilter name="result" value={filters.result} options={["success", "denied", "error"]} />
          <label className="text-sm">
            Action
            <AppInput name="action" defaultValue={filters.action ?? ""} maxLength={80} />
          </label>
          <label className="text-sm">
            From
            <AppInput name="from" type="date" defaultValue={filters.from ?? ""} />
          </label>
          <label className="text-sm">
            To
            <AppInput name="to" type="date" defaultValue={filters.to ?? ""} />
          </label>
        </>
      }
    />
  );
}
