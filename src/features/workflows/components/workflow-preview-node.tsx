"use client";

import { CircleAlert, TriangleAlert } from "lucide-react";
import { memo } from "react";

import { AppBadge } from "@/components/ui/app-badge";
import {
  accentForCategory,
  PREVIEW_STATE_LABELS,
  type PreviewAccent,
  type PreviewNode,
} from "@/features/workflows/domain/preview";
import { NODE_TYPES } from "@/features/workflows/domain/node-types";
import { cn } from "@/lib/cn";

/**
 * One node in the preview.
 *
 * It is a button rather than a draggable card: the preview is read-only, so
 * the only thing a node does is select itself for inspection. Category is
 * carried by the icon and the type caption as well as by the accent rail, so
 * the card never depends on colour alone.
 */

/** Accent rail per category. Tokens only, so both themes stay readable. */
const ACCENT_RAIL: Record<PreviewAccent, string> = {
  neutral: "bg-border-strong",
  trigger: "bg-foreground",
  input: "bg-info",
  ai: "bg-purple",
  condition: "bg-warning",
  tool: "bg-info",
  action: "bg-pink",
  output: "bg-success",
};

export interface WorkflowPreviewNodeProps {
  node: PreviewNode;
  selected: boolean;
  /** False while another node's neighbourhood is highlighted. */
  dimmed: boolean;
  /** Set when a run state is being shown; idle-only previews pass false. */
  showState: boolean;
  onSelect: (nodeId: string) => void;
}

function WorkflowPreviewNodeImpl({ node, selected, dimmed, showState, onSelect }: WorkflowPreviewNodeProps) {
  const Icon = NODE_TYPES[node.type].icon;
  const accent = accentForCategory(node.category);

  // The accessible name has to carry what the picture carries, because the
  // edges themselves are decorative to a screen reader.
  const describedAs = [
    `${node.label}.`,
    `${node.categoryLabel}, ${node.typeLabel}.`,
    node.summary,
    ...node.tags.map((tag) => tag.title),
    node.errorCount > 0 ? `${node.errorCount} error${node.errorCount === 1 ? "" : "s"}.` : "",
    showState ? `Status: ${PREVIEW_STATE_LABELS[node.state]}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      data-node-id={node.id}
      data-testid={`preview-node-${node.id}`}
      aria-pressed={selected}
      aria-label={describedAs}
      onClick={() => onSelect(node.id)}
      style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
      className={cn(
        "absolute flex overflow-hidden rounded-lg border bg-surface text-left shadow-xs transition-[opacity,border-color,box-shadow] duration-150 focus-ring",
        selected ? "border-foreground shadow-md" : "border-border hover:border-border-strong",
        dimmed ? "opacity-35" : "opacity-100",
      )}
    >
      <span aria-hidden className={cn("w-1 shrink-0", ACCENT_RAIL[accent])} />

      <span className="flex min-w-0 flex-1 flex-col gap-1 px-3 py-2.5">
        <span className="flex items-center gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-surface-muted text-foreground-secondary [&_svg]:size-3.5">
            <Icon aria-hidden />
          </span>
          <span className="min-w-0 flex-1 truncate text-caption font-medium uppercase tracking-wide text-foreground-subtle">
            {node.typeLabel}
          </span>
          {node.errorCount > 0 ? (
            <CircleAlert aria-hidden className="size-3.5 shrink-0 text-danger" />
          ) : node.warningCount > 0 ? (
            <TriangleAlert aria-hidden className="size-3.5 shrink-0 text-warning" />
          ) : null}
        </span>

        <span className="truncate text-sm font-medium text-foreground">{node.label}</span>
        <span className="truncate text-xs text-foreground-muted">{node.summary}</span>

        {node.tags.length > 0 || showState ? (
          <span className="flex flex-wrap items-center gap-1">
            {showState ? (
              <AppBadge size="sm" variant="outline" tone="neutral" dot>
                {PREVIEW_STATE_LABELS[node.state]}
              </AppBadge>
            ) : null}
            {node.tags.map((tag) => (
              <AppBadge key={tag.label} size="sm" variant="outline" tone="neutral" title={tag.title}>
                {tag.label}
              </AppBadge>
            ))}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/**
 * Memoized: panning and zooming change one transform on the wrapper, and a
 * large graph should not re-render every card because of it.
 */
export const WorkflowPreviewNode = memo(WorkflowPreviewNodeImpl);
