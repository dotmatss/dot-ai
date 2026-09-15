import { Database } from "lucide-react";
import type { Route } from "next";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppBadge } from "@/components/ui/app-badge";
import { AppCard } from "@/components/ui/app-card";
import { AppList, AppListItem } from "@/components/ui/app-list-item";
import { AppProgressBar } from "@/components/ui/app-progress";
import { AppHeading, AppText } from "@/components/ui/app-typography";
import type { EntitlementCheck } from "@/features/billing/types";
import { STORAGE_CATEGORY_META } from "@/features/settings/constants";
import type { StorageCategoryTotal, WorkspaceStorageSummary } from "@/features/settings/types";
import { hasMinimumRole, type MemberRole } from "@/features/workspaces/roles";
import { formatBytes, formatNumber } from "@/lib/format/number";

/**
 * Why there is no bar.
 *
 * A limit nobody has decided is not a limit, and the page says which kind of
 * silence it is rather than printing a number that would imply a business model
 * this product has not committed to. See `entitlement-rules.ts`.
 */
const NO_LIMIT_NOTE: Partial<Record<EntitlementCheck["reason"], string>> = {
  undecided: "No storage limit has been decided for this plan, so nothing here is capped.",
  no_plan: "This workspace is not on a plan. Storage is reported, not limited.",
  unknown_plan: "This workspace's plan is not in the catalogue, so no storage limit applies.",
  unlimited: "This plan does not cap storage.",
  included: "Storage is included in this plan with no stated ceiling.",
  agreed: "Storage for this workspace is agreed in a contract rather than set here.",
  not_measured: "A storage limit applies but could not be measured for this workspace.",
};

/** Amber at four fifths, red once it is spent - the usual three-step warning. */
function quotaTone(percent: number): "default" | "warning" | "danger" {
  if (percent >= 100) return "danger";
  if (percent >= 80) return "warning";
  return "default";
}

function StorageRow({
  total,
  workspaceSlug,
  role,
}: {
  total: StorageCategoryTotal;
  workspaceSlug: string;
  role: MemberRole;
}) {
  const meta = STORAGE_CATEGORY_META[total.category];
  const reachable = !meta.minimumRole || hasMinimumRole(role, meta.minimumRole);
  return (
    <AppListItem
      title={
        <span className="flex items-center gap-2">
          {meta.label}
          {meta.derived ? (
            <AppBadge tone="neutral" variant="outline">
              Derived
            </AppBadge>
          ) : null}
        </span>
      }
      description={meta.description}
      href={reachable ? (`/w/${workspaceSlug}${meta.manageAt}` as Route) : undefined}
      trailing={
        <span className="shrink-0 text-right">
          <span className="block text-sm font-medium tabular-nums text-foreground">{formatBytes(total.bytes)}</span>
          <span className="block text-xs tabular-nums text-foreground-muted">{formatNumber(total.rows)} rows</span>
        </span>
      }
    />
  );
}

/**
 * What this workspace is holding, and where to go and delete some of it.
 *
 * Presentational and server-rendered, like `UsageOverview`: the entitlement is
 * resolved by the page through the billing read model and handed over, so this
 * component never reaches across a feature boundary to ask about a plan.
 */
export function StorageOverview({
  storage,
  entitlement,
  workspaceSlug,
  role,
}: {
  storage: WorkspaceStorageSummary;
  entitlement: EntitlementCheck;
  workspaceSlug: string;
  role: MemberRole;
}) {
  const quota = entitlement.usage;
  const percent = quota && quota.limit > 0 ? (quota.current / quota.limit) * 100 : 0;

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <AppHeading level={2} className="text-lg">
          Storage
        </AppHeading>
        <AppCard padding="md" className="flex flex-col gap-3">
          <p className="text-2xl font-semibold tracking-tight tabular-nums">
            {quota
              ? `${formatBytes(quota.current)} of ${formatBytes(quota.limit)} used`
              : `${formatBytes(storage.totalBytes)} used`}
          </p>
          {quota ? (
            <>
              <AppProgressBar
                value={quota.current}
                max={quota.limit}
                label="Storage used"
                tone={quotaTone(percent)}
              />
              <AppText size="sm" tone="muted">
                {formatBytes(quota.remaining)} remaining.
              </AppText>
            </>
          ) : (
            <AppText size="sm" tone="muted">
              {NO_LIMIT_NOTE[entitlement.reason] ?? "No storage limit applies to this workspace."}
            </AppText>
          )}
          <AppText size="sm" tone="muted">
            Measured as the size of the rows this workspace owns, uncompressed and without indexes. The database on disk
            is organised differently, so treat this as what your content weighs rather than an exact billing figure.
          </AppText>
        </AppCard>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <AppHeading level={2} className="text-lg">
            Manage storage
          </AppHeading>
          <AppText size="sm" tone="muted">
            Largest first. A category marked derived is rebuilt from something else and shrinks when that is deleted.
          </AppText>
        </div>

        {storage.totalBytes === 0 ? (
          <AppEmptyState
            icon={<Database aria-hidden />}
            title="Nothing stored yet"
            description="Storage appears here once this workspace has a knowledge source, a conversation or a contact note."
          />
        ) : (
          <AppList>
            {storage.totals.map((total) => (
              <StorageRow key={total.category} total={total} workspaceSlug={workspaceSlug} role={role} />
            ))}
          </AppList>
        )}
      </section>
    </div>
  );
}
