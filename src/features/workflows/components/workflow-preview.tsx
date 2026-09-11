"use client";

import { Workflow as WorkflowIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppAlert } from "@/components/ui/app-alert";
import { AppCard } from "@/components/ui/app-card";
import { AppCaption, AppText } from "@/components/ui/app-typography";
import { WorkflowPreviewCanvas } from "@/features/workflows/components/workflow-preview-canvas";
import { WorkflowPreviewInspector } from "@/features/workflows/components/workflow-preview-inspector";
import { WorkflowPreviewSummary } from "@/features/workflows/components/workflow-preview-summary";
import type { WorkflowDefinition } from "@/features/workflows/domain/definition";
import { buildPreviewGraph } from "@/features/workflows/domain/preview";

/**
 * Read-only visualization of a workflow definition.
 *
 * It takes a definition and nothing else: no query, no store, no draft of its
 * own. The builder hands it the definition currently being edited, so the
 * preview is a projection of the same model the validator and the executor
 * read — there is never a second copy to drift.
 *
 * This shows what the workflow *is*, not what a run *did*. The distinction is
 * stated on the page, and no step here carries a run status, because nothing
 * in the builder has run.
 */

export interface WorkflowPreviewProps {
  definition: WorkflowDefinition;
  /** Shown next to the counts so an unsaved draft is not mistaken for the saved version. */
  unsaved?: boolean;
}

export function WorkflowPreview({ definition, unsaved = false }: WorkflowPreviewProps) {
  const graph = useMemo(() => buildPreviewGraph(definition), [definition]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  if (graph.empty) {
    return (
      <AppCard>
        <AppEmptyState
          icon={<WorkflowIcon aria-hidden />}
          title="Nothing to preview yet"
          description="Add a trigger and a few steps in the Build tab, then come back to see how they connect."
        />
      </AppCard>
    );
  }

  const errorCount = graph.issues.filter((issue) => issue.severity === "error").length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AppText size="sm" tone="muted">
          {graph.nodes.length} step{graph.nodes.length === 1 ? "" : "s"} · {graph.edges.length} connection
          {graph.edges.length === 1 ? "" : "s"}
          {unsaved ? " · showing unsaved changes" : ""}
        </AppText>
        <AppCaption>Read-only. Nothing on this tab changes the workflow or runs it.</AppCaption>
      </div>

      {errorCount > 0 ? (
        <AppAlert tone="warning" title="This workflow cannot run yet">
          The diagram shows the definition as it stands. {errorCount} problem{errorCount === 1 ? "" : "s"} listed on the Build
          tab {errorCount === 1 ? "has" : "have"} to be fixed first.
        </AppAlert>
      ) : null}

      {graph.droppedEdgeIds.length > 0 ? (
        <AppAlert tone="warning" title="Some connections are not drawn">
          {graph.droppedEdgeIds.length} connection{graph.droppedEdgeIds.length === 1 ? "" : "s"} point at a step that no longer
          exists, so {graph.droppedEdgeIds.length === 1 ? "it is" : "they are"} left out of the diagram.
        </AppAlert>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Below `md` the diagram is replaced by the walkthrough: shrinking a
            graph to phone width makes it unreadable rather than portable. */}
        <WorkflowPreviewCanvas
          graph={graph}
          selectedNodeId={selectedNodeId}
          onSelect={setSelectedNodeId}
          className="hidden h-[32rem] md:block lg:h-[36rem]"
        />

        <div className="lg:sticky lg:top-6">
          <WorkflowPreviewInspector graph={graph} selectedNodeId={selectedNodeId} />
        </div>
      </div>

      <AppCard>
        <div className="border-b border-border px-4 py-3">
          <AppText size="sm" weight="medium" as="div">
            Walkthrough
          </AppText>
          <AppCaption>Every step in the order the run reaches it, and where it goes next.</AppCaption>
        </div>
        <div className="p-2">
          <WorkflowPreviewSummary graph={graph} selectedNodeId={selectedNodeId} onSelect={setSelectedNodeId} />
        </div>
      </AppCard>
    </div>
  );
}
