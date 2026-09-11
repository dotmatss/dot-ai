import type { EdgeCondition, WorkflowDefinition, WorkflowEdge, WorkflowNode } from "@/features/workflows/domain/definition";
import { defaultOutgoingEdges, incomingEdges, outgoingEdges } from "@/features/workflows/domain/graph";
import { isBranchType, isTriggerType, NODE_TYPES, type WorkflowNodeType } from "@/features/workflows/domain/node-types";

/**
 * Pure edits on a definition, shared by the stepped builder and (later) the
 * canvas. Every function returns a new definition so the builder can keep an
 * undo-friendly history and compare against the saved version for dirty
 * tracking. Structural edits refuse ambiguous cases instead of guessing, so a
 * graph never silently loses a branch.
 */

function uniqueId(base: string, taken: ReadonlySet<string>): string {
  const root = base.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 32) || "step";
  if (!taken.has(root)) return root;
  for (let index = 2; index < 1000; index++) {
    const candidate = `${root}_${index}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${root}_${Date.now().toString(36)}`.slice(0, 40);
}

export function nextNodeId(definition: WorkflowDefinition, type: WorkflowNodeType): string {
  const base = type.split(".")[1] ?? type;
  return uniqueId(base, new Set(definition.nodes.map((node) => node.id)));
}

function nextEdgeId(definition: WorkflowDefinition): string {
  const taken = new Set(definition.edges.map((edge) => edge.id));
  for (let index = 1; index < 1000; index++) {
    const candidate = `e${index}`;
    if (!taken.has(candidate)) return candidate;
  }
  return uniqueId(`e${Date.now().toString(36)}`, taken);
}

export function createNode(definition: WorkflowDefinition, type: WorkflowNodeType): WorkflowNode {
  const nodeType = NODE_TYPES[type];
  return {
    id: nextNodeId(definition, type),
    type,
    label: nodeType.label,
    // Structured clone keeps nested defaults (headers, category lists) from
    // being shared between nodes.
    config: structuredClone(nodeType.defaultConfig),
  };
}

function sameEdge(a: WorkflowEdge, b: WorkflowEdge): boolean {
  return a.from === b.from && a.to === b.to && (a.condition ?? "default") === (b.condition ?? "default");
}

function dedupeEdges(edges: WorkflowEdge[]): WorkflowEdge[] {
  const out: WorkflowEdge[] = [];
  for (const edge of edges) {
    if (edge.from === edge.to) continue;
    if (out.some((existing) => sameEdge(existing, edge))) continue;
    out.push(edge);
  }
  return out;
}

export interface InsertPoint {
  nodeId: string;
  /** Which outcome of the anchor step the new step is inserted on. */
  outcome?: EdgeCondition;
}

function matchesOutcome(edge: WorkflowEdge, outcome: EdgeCondition | undefined): boolean {
  if (outcome === undefined || outcome === "default") return edge.condition === undefined || edge.condition === "default";
  return edge.condition === outcome;
}

/**
 * Adds a step. With an insert point the new step is spliced into that
 * connection, so adding in the middle of a sequence keeps the chain intact.
 */
export function addNode(definition: WorkflowDefinition, node: WorkflowNode, after?: InsertPoint): WorkflowDefinition {
  const nodes = [...definition.nodes, node];
  if (!after || !definition.nodes.some((existing) => existing.id === after.nodeId)) {
    return { nodes, edges: definition.edges };
  }

  // A new branch step inherits the previous continuation as its "true" path;
  // the validator then asks for the missing "otherwise" path.
  const inheritedCondition: EdgeCondition | undefined = isBranchType(node.type) ? "true" : undefined;
  const displaced = outgoingEdges(definition, after.nodeId).filter((edge) => matchesOutcome(edge, after.outcome));
  const untouched = definition.edges.filter((edge) => !displaced.includes(edge));

  const rewired = displaced.map((edge) => ({ ...edge, from: node.id, condition: inheritedCondition }));
  const link: WorkflowEdge = {
    id: nextEdgeId(definition),
    from: after.nodeId,
    to: node.id,
    ...(after.outcome && after.outcome !== "default" ? { condition: after.outcome } : {}),
  };

  return { nodes, edges: dedupeEdges([...untouched, link, ...rewired]) };
}

/** Removes a step and bridges its predecessors to its first continuation. */
export function removeNode(definition: WorkflowDefinition, nodeId: string): WorkflowDefinition {
  const nodes = definition.nodes.filter((node) => node.id !== nodeId);
  if (nodes.length === definition.nodes.length) return definition;

  const bridge = defaultOutgoingEdges(definition, nodeId)[0] ?? outgoingEdges(definition, nodeId)[0];
  const kept = definition.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);
  const rewired = bridge
    ? incomingEdges(definition, nodeId).map((edge) => ({ ...edge, to: bridge.to }))
    : [];

  return { nodes, edges: dedupeEdges([...kept, ...rewired]) };
}

export function updateNode(definition: WorkflowDefinition, nodeId: string, patch: Partial<Omit<WorkflowNode, "id">>): WorkflowDefinition {
  return {
    nodes: definition.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)),
    edges: definition.edges,
  };
}

/** Points one outcome of a step at an existing step, replacing any current target. */
export function setOutcomeTarget(
  definition: WorkflowDefinition,
  fromId: string,
  outcome: EdgeCondition | undefined,
  toId: string,
): WorkflowDefinition {
  const others = definition.edges.filter((edge) => !(edge.from === fromId && matchesOutcome(edge, outcome)));
  const edge: WorkflowEdge = {
    id: nextEdgeId(definition),
    from: fromId,
    to: toId,
    ...(outcome && outcome !== "default" ? { condition: outcome } : {}),
  };
  return { nodes: definition.nodes, edges: dedupeEdges([...others, edge]) };
}

export type MoveDirection = "up" | "down";

export type MoveCheck = { ok: true; partnerId: string } | { ok: false; reason: string };

function canSwap(definition: WorkflowDefinition, aId: string, bId: string): MoveCheck {
  const a = definition.nodes.find((node) => node.id === aId);
  const b = definition.nodes.find((node) => node.id === bId);
  if (!a || !b) return { ok: false, reason: "The neighbouring step no longer exists." };
  if (isTriggerType(a.type) || isTriggerType(b.type)) return { ok: false, reason: "The trigger always stays first." };
  if (isBranchType(a.type) || isBranchType(b.type)) {
    return { ok: false, reason: "Reorder branches by re-pointing their outcomes." };
  }
  const link = outgoingEdges(definition, aId).filter((edge) => edge.to === bId && matchesOutcome(edge, undefined));
  if (link.length !== 1) return { ok: false, reason: "These steps are not directly connected." };
  if (outgoingEdges(definition, aId).length !== 1 || incomingEdges(definition, bId).length !== 1) {
    return { ok: false, reason: "This step has more than one connection, so the order is ambiguous." };
  }
  return { ok: true, partnerId: bId };
}

export function canMoveNode(definition: WorkflowDefinition, nodeId: string, direction: MoveDirection): MoveCheck {
  if (direction === "down") {
    const next = defaultOutgoingEdges(definition, nodeId)[0];
    if (!next) return { ok: false, reason: "This is the last step in its path." };
    return canSwap(definition, nodeId, next.to);
  }
  const previous = incomingEdges(definition, nodeId)[0];
  if (!previous) return { ok: false, reason: "This is the first step in its path." };
  const check = canSwap(definition, previous.from, nodeId);
  return check.ok ? { ok: true, partnerId: previous.from } : check;
}

/**
 * Swaps a step with its neighbour: the pair's own connection is reversed,
 * the first step's inbound edges move to the second and the second step's
 * outbound edges move to the first.
 */
export function moveNode(
  definition: WorkflowDefinition,
  nodeId: string,
  direction: MoveDirection,
): { definition: WorkflowDefinition; moved: boolean; reason?: string } {
  const check = canMoveNode(definition, nodeId, direction);
  if (!check.ok) return { definition, moved: false, reason: check.reason };

  const [firstId, secondId] = direction === "down" ? [nodeId, check.partnerId] : [check.partnerId, nodeId];
  const edges = definition.edges.map((edge) => {
    if (edge.from === firstId && edge.to === secondId) return { ...edge, from: secondId, to: firstId };
    if (edge.to === firstId) return { ...edge, to: secondId };
    if (edge.from === secondId) return { ...edge, from: firstId };
    return edge;
  });

  return { definition: { nodes: definition.nodes, edges: dedupeEdges(edges) }, moved: true };
}
