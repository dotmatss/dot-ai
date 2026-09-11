"use client";

import { CornerDownRight } from "lucide-react";

import { AppBadge } from "@/components/ui/app-badge";
import type { PreviewGraph } from "@/features/workflows/domain/preview";
import { cn } from "@/lib/cn";

/**
 * The text equivalent of the diagram.
 *
 * A graph is not readable through a screen reader however carefully the nodes
 * are labelled, so the workflow is also published as an ordered list: each
 * step in reading order, what it does, and where the run goes next. This is
 * not a fallback that appears when something fails — it is always on the page,
 * and it is keyboard navigable, so it doubles as a quick index into a large
 * workflow.
 */

const EFFECT_NOTE: Record<string, string> = {
  simulated: "Recorded, not sent",
  live: "Makes a real request",
};

export interface WorkflowPreviewSummaryProps {
  graph: PreviewGraph;
  selectedNodeId: string | null;
  onSelect: (nodeId: string) => void;
}

export function WorkflowPreviewSummary({ graph, selectedNodeId, onSelect }: WorkflowPreviewSummaryProps) {
  if (graph.summary.length === 0) return null;

  return (
    <ol aria-label="Workflow walkthrough" className="flex flex-col gap-1">
      {graph.summary.map((step) => {
        const selected = selectedNodeId === step.nodeId;
        const note = EFFECT_NOTE[step.effect];
        return (
          <li key={step.nodeId}>
            <button
              type="button"
              onClick={() => onSelect(step.nodeId)}
              aria-current={selected ? "true" : undefined}
              className={cn(
                "flex w-full items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors focus-ring",
                selected ? "border-foreground bg-surface-muted" : "border-transparent hover:bg-surface-muted",
              )}
            >
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-caption font-semibold tabular-nums text-foreground-secondary">
                {step.index}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium text-foreground">{step.label}</span>
                  <span className="text-caption text-foreground-subtle">
                    {step.categoryLabel} · {step.typeLabel}
                  </span>
                  {note ? (
                    <AppBadge size="sm" variant="outline" tone="neutral">
                      {note}
                    </AppBadge>
                  ) : null}
                  {step.unreachable ? (
                    <AppBadge size="sm" variant="outline" tone="warning">
                      Never runs
                    </AppBadge>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-xs text-foreground-muted">{step.summary}</span>
                {step.next.length > 0 ? (
                  <span className="mt-1 flex flex-col gap-0.5">
                    {step.next.map((next, index) => (
                      <span
                        key={`${next.outcome ?? "next"}-${next.label}-${index}`}
                        className="flex items-center gap-1.5 text-caption text-foreground-muted"
                      >
                        <CornerDownRight aria-hidden className="size-3 shrink-0" />
                        {next.outcome ? `${next.outcome} → ${next.label}` : `Then ${next.label}`}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="mt-1 block text-caption text-foreground-subtle">The run ends here.</span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
