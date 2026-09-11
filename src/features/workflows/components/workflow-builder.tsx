"use client";

import { Plus, RotateCcw, Save, Workflow as WorkflowIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppBadge } from "@/components/ui/app-badge";
import { AppButton } from "@/components/ui/app-button";
import { AppCard } from "@/components/ui/app-card";
import { AppSkeleton } from "@/components/ui/app-skeleton";
import { AppCaption, AppText } from "@/components/ui/app-typography";
import { AddStepDialog } from "@/features/workflows/components/add-step-dialog";
import { BuilderStepCard } from "@/features/workflows/components/builder-step-card";
import { DefinitionIssues } from "@/features/workflows/components/definition-issues";
import { NodeConfigPanel } from "@/features/workflows/components/node-config-panel";
import { validateDefinition, type EdgeCondition, type WorkflowDefinition } from "@/features/workflows/domain/definition";
import { type InsertPoint } from "@/features/workflows/domain/edits";
import { defaultOutgoingEdges, displayOrder, incomingEdges } from "@/features/workflows/domain/graph";
import { isBranchType, isTriggerType, NODE_TYPES, type WorkflowNodeType } from "@/features/workflows/domain/node-types";
import { useBuilderState } from "@/features/workflows/hooks/use-builder-state";
import { useUpdateWorkflowMutation } from "@/features/workflows/mutations";
import { useWorkflowQuery } from "@/features/workflows/queries";
import type { Workflow } from "@/features/workflows/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit } from "@/features/workspaces/roles";
import { toast } from "@/stores/toast-store";

/**
 * The builder renders the graph as a vertical, keyboard-operable list in
 * topological order. It edits a local copy of the definition (see
 * `useBuilderState`) and publishes it with one PATCH, which is what bumps the
 * workflow version.
 */

/** Where a new step should go when added from the toolbar: the first free slot. */
function toolbarInsertPoint(definition: WorkflowDefinition): InsertPoint | undefined {
  const order = displayOrder(definition);
  let lastConnectable: string | undefined;
  for (const id of order) {
    const node = definition.nodes.find((candidate) => candidate.id === id);
    if (!node || isBranchType(node.type) || NODE_TYPES[node.type].outputs.length === 0) continue;
    lastConnectable = node.id;
    if (defaultOutgoingEdges(definition, node.id).length === 0) return { nodeId: node.id };
  }
  return lastConnectable ? { nodeId: lastConnectable } : undefined;
}

function BuilderView({ workflow }: { workflow: Workflow }) {
  const { membership } = useWorkspace();
  const editable = canEdit(membership.role);
  const builder = useBuilderState(workflow.definition);
  const update = useUpdateWorkflowMutation(workflow.id, { silent: true });
  const [picker, setPicker] = useState<{ open: boolean; after?: InsertPoint }>({ open: false });

  const issues = useMemo(() => validateDefinition(builder.definition), [builder.definition]);
  const order = useMemo(() => displayOrder(builder.definition), [builder.definition]);
  const hasTrigger = builder.definition.nodes.some((node) => isTriggerType(node.type));

  const errorsByNode = useMemo(() => {
    const counts = new Map<string, number>();
    for (const issue of issues) {
      if (issue.severity !== "error" || !issue.nodeId) continue;
      counts.set(issue.nodeId, (counts.get(issue.nodeId) ?? 0) + 1);
    }
    return counts;
  }, [issues]);

  // Leaving with unsaved edits would silently drop them.
  useEffect(() => {
    if (!builder.dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [builder.dirty]);

  const save = () => {
    update.mutate(
      { definition: builder.definition },
      {
        onSuccess: (saved) => {
          builder.reset(saved.definition);
          toast.success({ title: `Saved version ${saved.version}`, description: "The workflow definition is up to date." });
        },
      },
    );
  };

  const anchorLabel = picker.after
    ? (builder.definition.nodes.find((node) => node.id === picker.after?.nodeId)?.label ?? null)
    : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <AppText size="sm" tone="muted">
            {builder.definition.nodes.length} step{builder.definition.nodes.length === 1 ? "" : "s"} · saved version{" "}
            {workflow.version}
          </AppText>
          {builder.dirty ? (
            <AppBadge tone="warning" dot size="sm">
              Unsaved changes
            </AppBadge>
          ) : null}
        </div>
        {editable ? (
          <div className="flex flex-wrap items-center gap-2">
            <AppButton
              variant="secondary"
              leadingIcon={<Plus aria-hidden />}
              onClick={() => setPicker({ open: true, after: toolbarInsertPoint(builder.definition) })}
            >
              Add step
            </AppButton>
            <AppButton
              variant="ghost"
              leadingIcon={<RotateCcw aria-hidden />}
              disabled={!builder.dirty || update.isPending}
              onClick={() => builder.reset(workflow.definition)}
            >
              Discard
            </AppButton>
            <AppButton
              leadingIcon={<Save aria-hidden />}
              disabled={!builder.dirty}
              loading={update.isPending}
              onClick={save}
            >
              Save
            </AppButton>
          </div>
        ) : (
          <AppCaption>Read-only: you need the member role to edit this workflow.</AppCaption>
        )}
      </div>

      <DefinitionIssues issues={issues} onSelect={builder.select} quiet={!editable} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {builder.definition.nodes.length === 0 ? (
          <AppCard>
            <AppEmptyState
              icon={<WorkflowIcon aria-hidden />}
              title="Start with a trigger"
              description="Every workflow begins with one trigger: a manual start, an incoming webhook or a new conversation."
              action={
                editable ? (
                  <AppButton leadingIcon={<Plus aria-hidden />} onClick={() => setPicker({ open: true })}>
                    Add a trigger
                  </AppButton>
                ) : null
              }
            />
          </AppCard>
        ) : (
          <ol className="flex flex-col">
            {order.map((nodeId, index) => {
              const node = builder.definition.nodes.find((candidate) => candidate.id === nodeId);
              if (!node) return null;
              const incoming = incomingEdges(builder.definition, node.id).find(
                (edge) => edge.condition === "true" || edge.condition === "false",
              );
              const source = incoming ? builder.definition.nodes.find((candidate) => candidate.id === incoming.from) : undefined;
              const incomingLabel =
                incoming && source
                  ? `${NODE_TYPES[source.type].outputs.find((port) => port.id === incoming.condition)?.label ?? incoming.condition} · ${source.label}`
                  : null;

              return (
                <BuilderStepCard
                  key={node.id}
                  index={index + 1}
                  node={node}
                  definition={builder.definition}
                  selected={builder.selectedNodeId === node.id}
                  editable={editable}
                  errorCount={errorsByNode.get(node.id) ?? 0}
                  incomingLabel={incomingLabel}
                  onSelect={() => builder.select(node.id)}
                  onRemove={() => builder.removeStep(node.id)}
                  onMove={(direction) => builder.moveStep(node.id, direction)}
                  onAddAfter={(outcome?: EdgeCondition) => setPicker({ open: true, after: { nodeId: node.id, outcome } })}
                  onWire={(outcome, toId) => builder.wireOutcome(node.id, outcome, toId)}
                />
              );
            })}
          </ol>
        )}

        <div className="lg:sticky lg:top-6">
          {builder.selectedNode ? (
            <NodeConfigPanel
              key={builder.selectedNode.id}
              node={builder.selectedNode}
              editable={editable}
              onApply={(patch) => {
                if (!builder.selectedNode) return;
                builder.updateStep(builder.selectedNode.id, patch);
              }}
            />
          ) : (
            <AppCard variant="muted">
              <AppEmptyState
                size="sm"
                title="No step selected"
                description="Choose a step to configure its prompt, condition or request. Changes apply to this draft until you save."
              />
            </AppCard>
          )}
        </div>
      </div>

      <AddStepDialog
        open={picker.open}
        onClose={() => setPicker({ open: false })}
        allowTriggers={!hasTrigger}
        anchorLabel={anchorLabel}
        onPick={(type: WorkflowNodeType) => builder.addStep(type, picker.after)}
      />
    </div>
  );
}

export function WorkflowBuilder({ workflowId }: { workflowId: string }) {
  const query = useWorkflowQuery(workflowId);

  if (query.isPending) {
    return (
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]" aria-busy="true">
        <div className="flex flex-col gap-3">
          <AppSkeleton className="h-20" />
          <AppSkeleton className="h-20" />
          <AppSkeleton className="h-20" />
        </div>
        <AppSkeleton className="h-64" />
      </div>
    );
  }
  if (query.isError) {
    return <AppErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }
  // Keyed by workflow so switching workflows starts a fresh editing session;
  // saving re-seeds the draft in place (see `builder.reset`) to keep selection.
  return <BuilderView key={query.data.id} workflow={query.data} />;
}
