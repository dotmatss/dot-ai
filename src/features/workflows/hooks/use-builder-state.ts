"use client";

import { useCallback, useMemo, useState } from "react";

import type { EdgeCondition, WorkflowDefinition, WorkflowNode } from "@/features/workflows/domain/definition";
import {
  addNode,
  createNode,
  moveNode,
  removeNode,
  setOutcomeTarget,
  updateNode,
  type InsertPoint,
  type MoveDirection,
} from "@/features/workflows/domain/edits";
import type { WorkflowNodeType } from "@/features/workflows/domain/node-types";

/**
 * Editing state for the builder.
 *
 * The definition being edited is client-only UI state, so it lives in React
 * state rather than in TanStack Query or a global store: the server copy stays
 * the query cache's business, and `reset` re-seeds the editor after a save or
 * a discard. Dirty tracking compares serialized snapshots, which is cheap for
 * the definition sizes the schema allows and immune to reference churn.
 */

export interface BuilderState {
  definition: WorkflowDefinition;
  selectedNodeId: string | null;
  selectedNode: WorkflowNode | null;
  dirty: boolean;
  select: (nodeId: string | null) => void;
  addStep: (type: WorkflowNodeType, after?: InsertPoint) => void;
  removeStep: (nodeId: string) => void;
  moveStep: (nodeId: string, direction: MoveDirection) => void;
  updateStep: (nodeId: string, patch: { label?: string; config?: Record<string, unknown> }) => void;
  wireOutcome: (fromId: string, outcome: EdgeCondition | undefined, toId: string) => void;
  reset: (definition: WorkflowDefinition) => void;
}

export function useBuilderState(initial: WorkflowDefinition): BuilderState {
  const [definition, setDefinition] = useState<WorkflowDefinition>(initial);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  // Serialized snapshot of the last saved definition; comparing against it is
  // what makes the Save and Discard controls truthful.
  const [baseline, setBaseline] = useState(() => JSON.stringify(initial));

  const reset = useCallback((next: WorkflowDefinition) => {
    setBaseline(JSON.stringify(next));
    setDefinition(next);
    // Keep the current selection when that step survived the reset.
    setSelectedNodeId((current) => (current && next.nodes.some((node) => node.id === current) ? current : null));
  }, []);

  // Not an updater callback: the new step's id has to be known here so it can
  // also be selected.
  const addStep = useCallback(
    (type: WorkflowNodeType, after?: InsertPoint) => {
      const node = createNode(definition, type);
      setDefinition(addNode(definition, node, after));
      setSelectedNodeId(node.id);
    },
    [definition],
  );

  const removeStep = useCallback((nodeId: string) => {
    setDefinition((current) => removeNode(current, nodeId));
    setSelectedNodeId((current) => (current === nodeId ? null : current));
  }, []);

  // Callers disable the up/down controls with `canMoveNode`, so an impossible
  // move is simply a no-op here.
  const moveStep = useCallback((nodeId: string, direction: MoveDirection) => {
    setDefinition((current) => {
      const result = moveNode(current, nodeId, direction);
      return result.moved ? result.definition : current;
    });
  }, []);

  const updateStep = useCallback((nodeId: string, patch: { label?: string; config?: Record<string, unknown> }) => {
    setDefinition((current) => updateNode(current, nodeId, patch));
  }, []);

  const wireOutcome = useCallback((fromId: string, outcome: EdgeCondition | undefined, toId: string) => {
    setDefinition((current) => setOutcomeTarget(current, fromId, outcome, toId));
  }, []);

  const dirty = useMemo(() => JSON.stringify(definition) !== baseline, [definition, baseline]);
  const selectedNode = useMemo(
    () => definition.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [definition.nodes, selectedNodeId],
  );

  return {
    definition,
    selectedNodeId,
    selectedNode,
    dirty,
    select: setSelectedNodeId,
    addStep,
    removeStep,
    moveStep,
    updateStep,
    wireOutcome,
    reset,
  };
}
