"use client";

import { ArrowDown, ArrowUp, CircleAlert, CornerDownRight, Plus, Trash2 } from "lucide-react";

import { AppBadge } from "@/components/ui/app-badge";
import { AppButton } from "@/components/ui/app-button";
import { AppCard } from "@/components/ui/app-card";
import { AppSelect } from "@/components/ui/app-select";
import type { EdgeCondition, WorkflowDefinition, WorkflowNode } from "@/features/workflows/domain/definition";
import { describeNodeConfig } from "@/features/workflows/domain/describe";
import { canMoveNode, type MoveDirection } from "@/features/workflows/domain/edits";
import { outgoingEdges } from "@/features/workflows/domain/graph";
import { isBranchType, NODE_TYPES } from "@/features/workflows/domain/node-types";
import { cn } from "@/lib/cn";

export interface BuilderStepCardProps {
  index: number;
  node: WorkflowNode;
  definition: WorkflowDefinition;
  selected: boolean;
  editable: boolean;
  errorCount: number;
  /** Branch outcome that leads into this step, if any. */
  incomingLabel: string | null;
  onSelect: () => void;
  onRemove: () => void;
  onMove: (direction: MoveDirection) => void;
  onAddAfter: (outcome?: EdgeCondition) => void;
  onWire: (outcome: EdgeCondition | undefined, toId: string) => void;
}

function MoveButton({
  node,
  definition,
  direction,
  onMove,
}: {
  node: WorkflowNode;
  definition: WorkflowDefinition;
  direction: MoveDirection;
  onMove: (direction: MoveDirection) => void;
}) {
  const check = canMoveNode(definition, node.id, direction);
  const label = `Move “${node.label}” ${direction}`;
  return (
    <AppButton
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={check.ok ? label : check.reason}
      disabled={!check.ok}
      onClick={() => onMove(direction)}
    >
      {direction === "up" ? <ArrowUp aria-hidden /> : <ArrowDown aria-hidden />}
    </AppButton>
  );
}

/**
 * One step in the vertical builder list. The card is not a single button so
 * the per-step actions stay independently focusable; selecting a step is its
 * own control marked with `aria-current`.
 */
export function BuilderStepCard({
  index,
  node,
  definition,
  selected,
  editable,
  errorCount,
  incomingLabel,
  onSelect,
  onRemove,
  onMove,
  onAddAfter,
  onWire,
}: BuilderStepCardProps) {
  const nodeType = NODE_TYPES[node.type];
  const Icon = nodeType.icon;
  const branch = isBranchType(node.type);
  const candidates = definition.nodes.filter((candidate) => candidate.id !== node.id);

  return (
    <li className="flex flex-col">
      {incomingLabel ? (
        <span className="mb-1 ml-3 flex items-center gap-1.5 text-caption font-medium text-foreground-muted">
          <CornerDownRight aria-hidden className="size-3" />
          {incomingLabel}
        </span>
      ) : null}

      <AppCard className={cn("transition-shadow", selected ? "border-foreground shadow-md" : "hover:border-border-strong")}>
        <div className="flex items-start gap-3 p-4">
          <button
            type="button"
            onClick={onSelect}
            aria-current={selected ? "true" : undefined}
            className="flex min-w-0 flex-1 items-start gap-3 rounded-md text-left focus-ring"
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface-muted text-caption font-semibold tabular-nums text-foreground-secondary">
              {index}
            </span>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-foreground-secondary [&_svg]:size-4">
              <Icon aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground">{node.label}</span>
                <span className="text-caption text-foreground-subtle">{nodeType.label}</span>
              </span>
              <span className="mt-0.5 block truncate text-xs text-foreground-muted">{describeNodeConfig(node)}</span>
            </span>
          </button>

          <div className="flex shrink-0 items-center gap-1">
            {errorCount > 0 ? (
              <AppBadge tone="danger" size="sm" icon={<CircleAlert aria-hidden />}>
                {errorCount} issue{errorCount === 1 ? "" : "s"}
              </AppBadge>
            ) : null}
            {editable ? (
              <>
                <MoveButton node={node} definition={definition} direction="up" onMove={onMove} />
                <MoveButton node={node} definition={definition} direction="down" onMove={onMove} />
                <AppButton
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove “${node.label}”`}
                  title={`Remove “${node.label}”`}
                  onClick={onRemove}
                  className="text-foreground-muted hover:text-danger"
                >
                  <Trash2 aria-hidden />
                </AppButton>
              </>
            ) : null}
          </div>
        </div>

        {branch ? (
          <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
            {nodeType.outputs.map((port) => {
              const outcome = port.id as EdgeCondition;
              const edge = outgoingEdges(definition, node.id).find((candidate) => candidate.condition === outcome);
              const target = edge ? definition.nodes.find((candidate) => candidate.id === edge.to) : undefined;
              return (
                <div key={port.id} className="flex flex-wrap items-center gap-2">
                  <AppBadge variant="outline" size="sm">
                    {port.label}
                  </AppBadge>
                  {editable ? (
                    <>
                      <div className="w-48">
                        <AppSelect
                          size="sm"
                          aria-label={`Step after “${node.label}” when ${port.label.toLowerCase()}`}
                          value={target?.id ?? ""}
                          onChange={(event) => {
                            if (event.target.value) onWire(outcome, event.target.value);
                          }}
                          options={[
                            { value: "", label: "Not connected", disabled: true },
                            ...candidates.map((candidate) => ({ value: candidate.id, label: candidate.label })),
                          ]}
                        />
                      </div>
                      <AppButton variant="ghost" size="sm" leadingIcon={<Plus aria-hidden />} onClick={() => onAddAfter(outcome)}>
                        Add step
                      </AppButton>
                    </>
                  ) : (
                    <span className="text-xs text-foreground-muted">{target?.label ?? "Not connected"}</span>
                  )}
                </div>
              );
            })}
          </div>
        ) : null}
      </AppCard>

      {nodeType.outputs.length > 0 && !branch ? (
        <div className="flex items-center gap-2 py-1 pl-3">
          <span aria-hidden className="h-7 w-px bg-border" />
          {editable ? (
            <AppButton
              variant="ghost"
              size="sm"
              leadingIcon={<Plus aria-hidden />}
              onClick={() => onAddAfter()}
              className="text-foreground-muted"
            >
              Add step here
            </AppButton>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
