"use client";

import { AppAlert } from "@/components/ui/app-alert";
import { AppButton } from "@/components/ui/app-button";
import type { DefinitionIssue } from "@/features/workflows/domain/definition";

const MAX_SHOWN = 4;

function IssueList({ issues, onSelect }: { issues: DefinitionIssue[]; onSelect: (nodeId: string) => void }) {
  const shown = issues.slice(0, MAX_SHOWN);
  return (
    <ul className="flex flex-col gap-1">
      {shown.map((issue, index) => (
        <li key={`${issue.code}-${issue.nodeId ?? issue.edgeId ?? index}`} className="flex flex-wrap items-baseline gap-x-2">
          <span>{issue.message}</span>
          {issue.nodeId ? (
            <AppButton variant="link" className="text-xs" onClick={() => onSelect(issue.nodeId as string)}>
              Open step
            </AppButton>
          ) : null}
        </li>
      ))}
      {issues.length > shown.length ? (
        <li className="text-xs text-foreground-muted">and {issues.length - shown.length} more…</li>
      ) : null}
    </ul>
  );
}

/**
 * Live validation feedback for the builder. Errors block activation and runs;
 * warnings are advice, so both are shown but tonally separated and always
 * labelled (never colour alone).
 */
export function DefinitionIssues({
  issues,
  onSelect,
  quiet,
}: {
  issues: DefinitionIssue[];
  onSelect: (nodeId: string) => void;
  /** Hide the "all good" confirmation, e.g. for read-only viewers. */
  quiet?: boolean;
}) {
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");

  if (errors.length === 0 && warnings.length === 0) {
    if (quiet) return null;
    return (
      <AppAlert tone="success" title="No problems found">
        Every step is configured and connected. This workflow is ready to activate.
      </AppAlert>
    );
  }

  return (
    <div className="flex flex-col gap-3" aria-label="Builder issues">
      {errors.length > 0 ? (
        <AppAlert tone="danger" title={`${errors.length} problem${errors.length === 1 ? "" : "s"} to fix before activating`}>
          <IssueList issues={errors} onSelect={onSelect} />
        </AppAlert>
      ) : null}
      {warnings.length > 0 ? (
        <AppAlert tone="warning" title={`${warnings.length} suggestion${warnings.length === 1 ? "" : "s"}`}>
          <IssueList issues={warnings} onSelect={onSelect} />
        </AppAlert>
      ) : null}
    </div>
  );
}
