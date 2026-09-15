"use client";

import { Sparkles } from "lucide-react";

import { AppBadge } from "@/components/ui/app-badge";
import { AppButton } from "@/components/ui/app-button";
import { AppRelativeTime } from "@/components/ui/app-relative-time";
import { AppTooltip } from "@/components/ui/app-tooltip";
import { DEFAULT_ANALYSIS_WINDOW_DAYS, RUN_STATUS_META } from "@/features/intelligence/constants";
import { useRunAnalysisMutation } from "@/features/intelligence/mutations";
import { useAnalysisRunsQuery } from "@/features/intelligence/queries";
import type { AnalysisRun } from "@/features/intelligence/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit } from "@/features/workspaces/roles";

/**
 * Starts an analysis, and says when the last one ran.
 *
 * The freshness line is not decoration. Every figure on this page is as old as
 * the run that produced it, and a dashboard that looks live while showing
 * last week's numbers is the specific failure this feature is meant to avoid.
 */
export function RunAnalysisButton({ latestRun: seeded }: { latestRun: AnalysisRun | null }) {
  const { membership } = useWorkspace();
  const mutation = useRunAnalysisMutation();
  const allowed = canEdit(membership.role);

  // Seeded by the server page, then kept current by the same invalidation that
  // refreshes the tiles - so "Last analyzed" is not still saying "3 days ago"
  // immediately after somebody watched an analysis finish.
  const runs = useAnalysisRunsQuery();
  const latestRun = runs.data?.[0] ?? seeded;

  const status = latestRun ? RUN_STATUS_META[latestRun.status] : null;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {latestRun ? (
        <span className="flex items-center gap-2 text-xs text-foreground-muted">
          {status ? (
            <AppBadge tone={status.tone} size="sm">
              {status.label}
            </AppBadge>
          ) : null}
          {latestRun.finishedAt ? (
            <span>
              Last analyzed <AppRelativeTime value={latestRun.finishedAt} />
            </span>
          ) : (
            <span>Started <AppRelativeTime value={latestRun.startedAt} /></span>
          )}
        </span>
      ) : null}

      <AppTooltip
        content={
          allowed
            ? `Reads the last ${DEFAULT_ANALYSIS_WINDOW_DAYS} days of conversations, groups them into topics and names each one.`
            : "Only members and above can run an analysis."
        }
      >
        <span>
          <AppButton
            onClick={() => mutation.mutate({ windowDays: DEFAULT_ANALYSIS_WINDOW_DAYS })}
            loading={mutation.isPending}
            disabled={!allowed}
          >
            <Sparkles aria-hidden />
            {latestRun ? "Re-analyze" : "Analyze conversations"}
          </AppButton>
        </span>
      </AppTooltip>
    </div>
  );
}
