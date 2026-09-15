"use client";

import { History } from "lucide-react";

import { AppAlert } from "@/components/ui/app-alert";
import { AppBadge } from "@/components/ui/app-badge";
import { AppCard, AppCardContent, AppCardHeader, AppCardTitle } from "@/components/ui/app-card";
import { AppRelativeTime } from "@/components/ui/app-relative-time";
import {
  AppTable,
  AppTableBody,
  AppTableCell,
  AppTableContainer,
  AppTableHead,
  AppTableHeader,
  AppTableRow,
} from "@/components/ui/app-table";
import { RUN_STATUS_META } from "@/features/intelligence/constants";
import { useAnalysisRunsQuery } from "@/features/intelligence/queries";
import type { AnalysisRun } from "@/features/intelligence/types";

/**
 * What the last few analyses did.
 *
 * This exists because `conversation_analysis_runs.error` was being written and
 * read by nobody: a run that failed left a message explaining why, and the only
 * visible consequence was that the numbers quietly stopped moving. A failure a
 * customer cannot see is a failure they will report as "the topics are wrong".
 */
export function AnalysisHistory() {
  const query = useAnalysisRunsQuery();
  const runs = query.data ?? [];
  if (runs.length === 0) return null;

  const failed = runs.filter((run) => run.status === "failed");

  return (
    <AppCard variant="bordered">
      <AppCardHeader>
        <AppCardTitle className="flex items-center gap-2">
          <History className="size-4 text-foreground-subtle" aria-hidden />
          Analysis history
        </AppCardTitle>
      </AppCardHeader>
      <AppCardContent className="flex flex-col gap-4">
        {/* The most recent failure is surfaced above the table: its message is
            the one piece of a run anybody actually needs to read. */}
        {failed[0]?.error ? (
          <AppAlert tone="danger" title="The last failed analysis reported">
            {failed[0].error}
          </AppAlert>
        ) : null}

        <AppTableContainer>
          <AppTable>
            <AppTableHeader>
              <AppTableRow>
                <AppTableHead>Started</AppTableHead>
                <AppTableHead>Status</AppTableHead>
                <AppTableHead>Conversations</AppTableHead>
                <AppTableHead>New topics</AppTableHead>
                <AppTableHead>Named</AppTableHead>
                <AppTableHead>Tokens</AppTableHead>
              </AppTableRow>
            </AppTableHeader>
            <AppTableBody>
              {runs.map((run) => (
                <RunRow key={run.id} run={run} />
              ))}
            </AppTableBody>
          </AppTable>
        </AppTableContainer>
      </AppCardContent>
    </AppCard>
  );
}

function RunRow({ run }: { run: AnalysisRun }) {
  const status = RUN_STATUS_META[run.status];
  const tokens = run.tokensIn + run.tokensOut;

  return (
    <AppTableRow>
      <AppTableCell className="whitespace-nowrap text-foreground-muted">
        <AppRelativeTime value={run.startedAt} />
      </AppTableCell>
      <AppTableCell>
        <AppBadge tone={status.tone} size="sm">
          {status.label}
        </AppBadge>
      </AppTableCell>
      <AppTableCell className="tabular-nums text-foreground-secondary">
        {run.conversationsAnalyzed.toLocaleString("en")}
      </AppTableCell>
      <AppTableCell className="tabular-nums text-foreground-secondary">{run.topicsCreated}</AppTableCell>
      <AppTableCell className="tabular-nums text-foreground-secondary">{run.topicsLabeled}</AppTableCell>
      <AppTableCell className="tabular-nums text-foreground-muted">
        {tokens === 0 ? <span className="text-foreground-subtle">—</span> : tokens.toLocaleString("en")}
      </AppTableCell>
    </AppTableRow>
  );
}
