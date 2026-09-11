"use client";

import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppBadge } from "@/components/ui/app-badge";
import { AppCard } from "@/components/ui/app-card";
import { AppCaption, AppText } from "@/components/ui/app-typography";
import { NODE_TYPES } from "@/features/workflows/domain/node-types";
import type { PreviewGraph, PreviewNode } from "@/features/workflows/domain/preview";

/**
 * Details of the selected node.
 *
 * Read-only by construction: it renders values, never form controls, and takes
 * no change handler. It shows the few configuration values that explain what a
 * step does — not the whole configuration editor, which lives in the Build tab
 * where edits belong.
 */

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-1.5">
      <dt className="text-caption text-foreground-subtle">{label}</dt>
      <dd className="min-w-0 break-words text-xs text-foreground-secondary">{value}</dd>
    </div>
  );
}

function Connections({ graph, node }: { graph: PreviewGraph; node: PreviewNode }) {
  const labelOf = (id: string) => graph.nodes.find((candidate) => candidate.id === id)?.label ?? id;
  const incoming = graph.edges.filter((edge) => edge.to === node.id);
  const outgoing = graph.edges.filter((edge) => edge.from === node.id);

  return (
    <div className="flex flex-col gap-3 border-t border-border px-4 py-3">
      <div className="flex flex-col gap-1">
        <AppCaption className="flex items-center gap-1.5">
          <ArrowDownToLine aria-hidden className="size-3" />
          Comes from
        </AppCaption>
        {incoming.length === 0 ? (
          <AppText size="sm" tone="subtle">
            {node.isTrigger ? "Nothing: this step starts the run." : "Nothing is connected to this step."}
          </AppText>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {incoming.map((edge) => (
              <li key={edge.id} className="text-xs text-foreground-secondary">
                {labelOf(edge.from)}
                {edge.label ? ` · ${edge.label}` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <AppCaption className="flex items-center gap-1.5">
          <ArrowUpFromLine aria-hidden className="size-3" />
          Goes to
        </AppCaption>
        {outgoing.length === 0 ? (
          <AppText size="sm" tone="subtle">
            {node.isTerminal ? "Nothing: the run ends here." : "Nothing yet."}
          </AppText>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {outgoing.map((edge) => (
              <li key={edge.id} className="text-xs text-foreground-secondary">
                {edge.label ? `${edge.label} → ` : ""}
                {labelOf(edge.to)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export interface WorkflowPreviewInspectorProps {
  graph: PreviewGraph;
  selectedNodeId: string | null;
}

export function WorkflowPreviewInspector({ graph, selectedNodeId }: WorkflowPreviewInspectorProps) {
  const node = graph.nodes.find((candidate) => candidate.id === selectedNodeId) ?? null;

  if (!node) {
    return (
      <AppCard variant="muted">
        <AppEmptyState
          size="sm"
          title="No step selected"
          description="Choose a step in the diagram or the walkthrough to see what it does and how it is connected."
        />
      </AppCard>
    );
  }

  const Icon = NODE_TYPES[node.type].icon;

  return (
    <AppCard>
      <div className="flex items-start gap-3 p-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-muted text-foreground-secondary [&_svg]:size-4">
          <Icon aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <AppText weight="medium" truncate>
            {node.label}
          </AppText>
          <AppCaption>
            {node.categoryLabel} · {node.typeLabel}
          </AppCaption>
        </div>
      </div>

      {node.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 px-4 pb-3">
          {node.tags.map((tag) => (
            <AppBadge key={tag.label} size="sm" variant="outline" tone="neutral" title={tag.title}>
              {tag.label}
            </AppBadge>
          ))}
        </div>
      ) : null}

      {node.details.length > 0 ? (
        <dl className="border-t border-border px-4 py-2">
          {node.details.map((detail) => (
            <Row key={detail.label} label={detail.label} value={detail.value} />
          ))}
        </dl>
      ) : null}

      <Connections graph={graph} node={node} />
    </AppCard>
  );
}
