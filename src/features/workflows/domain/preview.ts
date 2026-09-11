import {
  validateDefinition,
  type DefinitionIssue,
  type EdgeCondition,
  type WorkflowDefinition,
  type WorkflowNode,
} from "@/features/workflows/domain/definition";
import { describeNodeConfig, describeNodeDetails, describeNodeEffect, type NodeDetail, type NodeEffect } from "@/features/workflows/domain/describe";
import { displayOrder, reachableFrom } from "@/features/workflows/domain/graph";
import {
  isBranchType,
  isTriggerType,
  NODE_CATEGORY_META,
  NODE_TYPES,
  type NodeCategory,
  type NodePort,
  type WorkflowNodeType,
} from "@/features/workflows/domain/node-types";

/**
 * Projection from the canonical `WorkflowDefinition` onto a graph a renderer
 * can draw without knowing anything about Zod, the node registry or the
 * executor.
 *
 * This is the whole point of the preview architecture: there is one workflow
 * model, and this module is a read-only view of it. Nothing here mutates a
 * definition, and the renderer never reaches back past the model returned by
 * `buildPreviewGraph`. Because it is pure and DOM-free it is unit tested the
 * same way the chart geometry is.
 *
 * Everything a node "means" — its label, icon, ports, category — is read from
 * the node type registry, so registering a new node type (an MCP tool, an
 * agent, a knowledge lookup) makes it previewable without editing this file.
 */

/* -------------------------------------------------------------------------- */
/* Layout constants                                                           */
/* -------------------------------------------------------------------------- */

export const PREVIEW_NODE_WIDTH = 248;
export const PREVIEW_NODE_HEIGHT = 96;
const COLUMN_GAP = 44;
const ROW_GAP = 76;
const PADDING = 32;
/** Corner radius on the orthogonal edge elbows. */
const ELBOW = 12;

/* -------------------------------------------------------------------------- */
/* Model                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Run states a preview is *able* to show. Nothing in the builder produces
 * anything but `idle`: these exist so that execution visualization can reuse
 * this graph later (see `buildPreviewGraph`'s `states` option) instead of
 * growing a second model. A preview with no states passed shows no status at
 * all, which is what stops a diagram implying a run happened.
 */
export const PREVIEW_NODE_STATES = [
  "idle",
  "running",
  "completed",
  "failed",
  "waiting",
  "approval_required",
  "disabled",
  "skipped",
] as const;
export type PreviewNodeState = (typeof PREVIEW_NODE_STATES)[number];

export const PREVIEW_STATE_LABELS: Record<PreviewNodeState, string> = {
  idle: "Not started",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  waiting: "Waiting",
  approval_required: "Approval required",
  disabled: "Disabled",
  skipped: "Skipped",
};

/** A short, non-status tag shown on the node card. */
export interface PreviewTag {
  label: string;
  /** Why the tag is there, for tooltips and the accessible summary. */
  title: string;
}

export interface PreviewNode {
  id: string;
  type: WorkflowNodeType;
  /** Author's name for the step. */
  label: string;
  /** Registry name for the step's type, e.g. "Generate text". */
  typeLabel: string;
  category: NodeCategory;
  categoryLabel: string;
  /** One-line configuration summary, shared with the builder list. */
  summary: string;
  /** A few configuration values for the inspector. Never contains secrets. */
  details: ReadonlyArray<NodeDetail>;
  inputs: ReadonlyArray<NodePort>;
  outputs: ReadonlyArray<NodePort>;
  effect: NodeEffect;
  tags: ReadonlyArray<PreviewTag>;
  isTrigger: boolean;
  isBranch: boolean;
  /** No outgoing ports at all: the run ends here by design. */
  isTerminal: boolean;
  /** Not reachable from the trigger, so it never runs. A definition fact, not a run result. */
  unreachable: boolean;
  errorCount: number;
  warningCount: number;
  state: PreviewNodeState;
  /** Layout, in graph units. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0-based depth from the start of the workflow. */
  rank: number;
  /** 0-based position within the rank, left to right. */
  column: number;
}

export interface PreviewEdge {
  id: string;
  from: string;
  to: string;
  condition: EdgeCondition;
  /**
   * Outcome name taken from the source node type's output port, e.g.
   * "If true". Null on an ordinary sequential connection.
   */
  label: string | null;
  /** SVG path data, in graph units. */
  path: string;
  /** Where a label chip belongs, in graph units. */
  labelX: number;
  labelY: number;
  /** Points back up the graph: only possible in an invalid, cyclic definition. */
  back: boolean;
}

/** One line of the accessible, ordered text alternative to the diagram. */
export interface PreviewSummaryStep {
  /** 1-based position in reading order. */
  index: number;
  nodeId: string;
  label: string;
  typeLabel: string;
  categoryLabel: string;
  summary: string;
  effect: NodeEffect;
  unreachable: boolean;
  /** Where the run can go next, already phrased for a screen reader. */
  next: ReadonlyArray<{ label: string; outcome: string | null }>;
}

export interface PreviewGraph {
  nodes: ReadonlyArray<PreviewNode>;
  edges: ReadonlyArray<PreviewEdge>;
  /** Reading-order walkthrough; the accessible equivalent of the diagram. */
  summary: ReadonlyArray<PreviewSummaryStep>;
  issues: ReadonlyArray<DefinitionIssue>;
  /** Definition edges dropped because an endpoint is missing or self-referential. */
  droppedEdgeIds: ReadonlyArray<string>;
  width: number;
  height: number;
  /** True when there is nothing to draw. */
  empty: boolean;
}

export interface BuildPreviewOptions {
  /**
   * Run state per node id. Omit it for a static preview — the default leaves
   * every node `idle` and the renderer then shows no status at all.
   */
  states?: Readonly<Record<string, PreviewNodeState>>;
}

/* -------------------------------------------------------------------------- */
/* Presentation of a category                                                 */
/* -------------------------------------------------------------------------- */

export type PreviewAccent = "neutral" | "trigger" | "ai" | "condition" | "tool" | "action" | "output" | "input";

/**
 * Category → accent. Unknown categories fall back to `neutral` on purpose: a
 * node type registered after this file was written still renders, it just
 * renders plainly. That is what keeps the registry the single source of truth.
 */
const CATEGORY_ACCENTS: Partial<Record<NodeCategory, PreviewAccent>> = {
  trigger: "trigger",
  input: "input",
  ai: "ai",
  condition: "condition",
  tool: "tool",
  action: "action",
  output: "output",
};

export function accentForCategory(category: NodeCategory): PreviewAccent {
  return CATEGORY_ACCENTS[category] ?? "neutral";
}

/* -------------------------------------------------------------------------- */
/* Tags                                                                       */
/* -------------------------------------------------------------------------- */

function tagsFor(node: WorkflowNode, effect: NodeEffect, unreachable: boolean): PreviewTag[] {
  const tags: PreviewTag[] = [];
  const category = NODE_TYPES[node.type].category;

  if (category === "ai") {
    tags.push({ label: "AI", title: "This step calls a language model." });
  }
  if (effect === "simulated") {
    // The executor records what this step would have done. Saying so here is
    // the difference between an honest diagram and a misleading one.
    tags.push({ label: "Simulated", title: "Recorded rather than sent: this step does not reach an external system." });
  }
  if (effect === "live") {
    tags.push({ label: "Live call", title: "This step is allowed to make a real outbound request when it runs." });
  }
  if (unreachable) {
    tags.push({ label: "Never runs", title: "Nothing connects this step to the trigger." });
  }
  return tags;
}

/* -------------------------------------------------------------------------- */
/* Ranking and ordering                                                       */
/* -------------------------------------------------------------------------- */

interface VisualEdge {
  id: string;
  from: string;
  to: string;
  condition: EdgeCondition;
}

/** "true" reads left of the default path, "false" right of it. */
const OUTCOME_WEIGHT: Record<EdgeCondition, number> = { true: 0, default: 1, false: 2 };

/**
 * Edges that close a cycle, found by a depth-first walk: an edge reaching a
 * node still open on the stack is the one that loops.
 *
 * A cyclic definition is an error the validator reports, but the author still
 * has to see the graph in order to fix it. Naming the looping edge lets the
 * rest of the layout treat the remainder as the DAG it nearly is, and lets the
 * renderer draw that one edge differently instead of producing a tangle.
 *
 * Iterative rather than recursive: a 60-node definition is small, but a stack
 * overflow in a preview would be a poor way to find that out.
 */
function findBackEdges(ids: ReadonlyArray<string>, edges: ReadonlyArray<VisualEdge>): Set<string> {
  const adjacency = new Map<string, VisualEdge[]>(ids.map((id) => [id, []]));
  for (const edge of edges) adjacency.get(edge.from)?.push(edge);

  const indegree = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const edge of edges) indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);

  const OPEN = 1;
  const DONE = 2;
  const state = new Map<string, number>();
  const back = new Set<string>();

  // Roots first, so the walk follows the workflow from its trigger and the
  // edge blamed for a loop is the one a reader would also call the loop.
  const starts = [...ids.filter((id) => (indegree.get(id) ?? 0) === 0), ...ids];
  for (const root of starts) {
    if (state.has(root)) continue;
    state.set(root, OPEN);
    const stack: Array<{ id: string; index: number }> = [{ id: root, index: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (!frame) break;
      const outgoing = adjacency.get(frame.id) ?? [];
      if (frame.index >= outgoing.length) {
        state.set(frame.id, DONE);
        stack.pop();
        continue;
      }
      const edge = outgoing[frame.index];
      frame.index += 1;
      if (!edge) continue;
      const seen = state.get(edge.to);
      if (seen === OPEN) back.add(edge.id);
      else if (seen === undefined) {
        state.set(edge.to, OPEN);
        stack.push({ id: edge.to, index: 0 });
      }
    }
  }
  return back;
}

/**
 * Longest-path depth over the forward edges. Those form a DAG by construction,
 * so the relaxation settles; the pass cap is a belt-and-braces guard rather
 * than the thing that terminates it.
 */
function assignRanks(ids: ReadonlyArray<string>, edges: ReadonlyArray<VisualEdge>): Map<string, number> {
  const rank = new Map<string, number>(ids.map((id) => [id, 0]));
  for (let pass = 0; pass < ids.length; pass++) {
    let changed = false;
    for (const edge of edges) {
      const want = (rank.get(edge.from) ?? 0) + 1;
      if ((rank.get(edge.to) ?? 0) < want) {
        rank.set(edge.to, want);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return rank;
}

/* -------------------------------------------------------------------------- */
/* Edge geometry                                                              */
/* -------------------------------------------------------------------------- */

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

interface Placed {
  x: number;
  y: number;
}

/**
 * Orthogonal connector: straight down when the columns line up, otherwise down
 * to a midline, across, and down again with rounded elbows. Back edges (only
 * reachable in a cyclic definition) get a wide curve so they are visibly
 * different from the forward flow.
 */
function edgePath(source: Placed, target: Placed, back: boolean): { path: string; labelX: number; labelY: number } {
  const x1 = round(source.x + PREVIEW_NODE_WIDTH / 2);
  const y1 = round(source.y + PREVIEW_NODE_HEIGHT);
  const x2 = round(target.x + PREVIEW_NODE_WIDTH / 2);
  const y2 = round(target.y);

  if (back) {
    const side = round(Math.max(x1, x2) + PREVIEW_NODE_WIDTH / 2 + COLUMN_GAP);
    const exitY = round(source.y + PREVIEW_NODE_HEIGHT / 2);
    const entryY = round(target.y + PREVIEW_NODE_HEIGHT / 2);
    return {
      path: `M${round(source.x + PREVIEW_NODE_WIDTH)} ${exitY} C${side} ${exitY} ${side} ${entryY} ${round(target.x + PREVIEW_NODE_WIDTH)} ${entryY}`,
      labelX: side,
      labelY: round((exitY + entryY) / 2),
    };
  }

  if (Math.abs(x1 - x2) < 1) {
    return { path: `M${x1} ${y1} L${x2} ${y2}`, labelX: x1, labelY: round((y1 + y2) / 2) };
  }

  const midY = round((y1 + y2) / 2);
  const direction = x2 > x1 ? 1 : -1;
  // Keep the elbow radius inside the space actually available, so short hops
  // between adjacent columns do not produce a path that doubles back.
  const radius = round(Math.min(ELBOW, Math.abs(x2 - x1) / 2, Math.abs(midY - y1), Math.abs(y2 - midY)));
  const path = [
    `M${x1} ${y1}`,
    `L${x1} ${round(midY - radius)}`,
    `Q${x1} ${midY} ${round(x1 + radius * direction)} ${midY}`,
    `L${round(x2 - radius * direction)} ${midY}`,
    `Q${x2} ${midY} ${x2} ${round(midY + radius)}`,
    `L${x2} ${y2}`,
  ].join(" ");
  return { path, labelX: round((x1 + x2) / 2), labelY: midY };
}

/* -------------------------------------------------------------------------- */
/* Projection                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Builds the presentation graph.
 *
 * The definition is never trusted to be valid: duplicate ids, edges pointing
 * at deleted steps and cycles are all reachable states of the builder, and the
 * preview has to keep drawing while the validator explains them. Anything
 * unusable is dropped from the picture and reported in `droppedEdgeIds` or in
 * `issues`, which come from the one existing `validateDefinition`.
 */
export function buildPreviewGraph(definition: WorkflowDefinition, options: BuildPreviewOptions = {}): PreviewGraph {
  const issues = validateDefinition(definition);

  // First declaration wins for a duplicated id, matching how the rest of the
  // builder resolves `nodes.find`.
  const byId = new Map<string, WorkflowNode>();
  for (const node of definition.nodes) {
    if (!byId.has(node.id)) byId.set(node.id, node);
  }
  const nodes = [...byId.values()];

  if (nodes.length === 0) {
    return {
      nodes: [],
      edges: [],
      summary: [],
      issues,
      droppedEdgeIds: definition.edges.map((edge) => edge.id),
      width: 0,
      height: 0,
      empty: true,
    };
  }

  const droppedEdgeIds: string[] = [];
  const seenEdgeIds = new Set<string>();
  const edges: VisualEdge[] = [];
  for (const edge of definition.edges) {
    const usable = byId.has(edge.from) && byId.has(edge.to) && edge.from !== edge.to && !seenEdgeIds.has(edge.id);
    if (!usable) {
      droppedEdgeIds.push(edge.id);
      continue;
    }
    seenEdgeIds.add(edge.id);
    edges.push({ id: edge.id, from: edge.from, to: edge.to, condition: edge.condition ?? "default" });
  }

  const structural = { nodes: nodes.map((node) => ({ id: node.id })), edges };
  const order = displayOrder(structural);
  const orderIndex = new Map(order.map((id, index) => [id, index]));
  const ids = [...nodes]
    .map((node) => node.id)
    .sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));

  // Ranking (and therefore the whole layout) ignores the edges that loop, so
  // one bad connection cannot push the rest of the graph down the canvas.
  const backEdgeIds = findBackEdges(ids, edges);
  const forwardEdges = edges.filter((edge) => !backEdgeIds.has(edge.id));
  const rank = assignRanks(ids, forwardEdges);

  // Place rank by rank so a node can be positioned under the parent it hangs
  // from, and siblings of a branch read "if true" first.
  const column = new Map<string, number>();
  const ranks = [...new Set(ids.map((id) => rank.get(id) ?? 0))].sort((a, b) => a - b);
  const rows = new Map<number, string[]>();
  for (const depth of ranks) {
    const members = ids.filter((id) => (rank.get(id) ?? 0) === depth);
    const sortKey = (id: string): [number, number, number] => {
      let best: [number, number] | null = null;
      for (const edge of forwardEdges) {
        if (edge.to !== id) continue;
        const parentColumn = column.get(edge.from);
        if (parentColumn === undefined) continue;
        const candidate: [number, number] = [parentColumn, OUTCOME_WEIGHT[edge.condition]];
        if (!best || candidate[0] < best[0] || (candidate[0] === best[0] && candidate[1] < best[1])) best = candidate;
      }
      return best
        ? [best[0], best[1], orderIndex.get(id) ?? 0]
        : [Number.MAX_SAFE_INTEGER, 0, orderIndex.get(id) ?? 0];
    };
    const sorted = [...members].sort((a, b) => {
      const ka = sortKey(a);
      const kb = sortKey(b);
      return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2];
    });
    sorted.forEach((id, index) => column.set(id, index));
    rows.set(depth, sorted);
  }

  const widestRow = Math.max(...[...rows.values()].map((row) => row.length));
  const contentWidth = widestRow * PREVIEW_NODE_WIDTH + (widestRow - 1) * COLUMN_GAP;

  // Explicit positions are honoured whenever every node carries one, so a
  // future drag-to-arrange canvas writes `node.position` and this projection
  // starts drawing it without a schema change.
  const explicit = nodes.every((node) => node.position !== undefined);

  const placed = new Map<string, Placed>();
  for (const [depth, row] of rows) {
    const rowWidth = row.length * PREVIEW_NODE_WIDTH + (row.length - 1) * COLUMN_GAP;
    const offset = PADDING + (contentWidth - rowWidth) / 2;
    row.forEach((id, index) => {
      const node = byId.get(id);
      const auto = {
        x: round(offset + index * (PREVIEW_NODE_WIDTH + COLUMN_GAP)),
        y: round(PADDING + depth * (PREVIEW_NODE_HEIGHT + ROW_GAP)),
      };
      placed.set(id, explicit && node?.position ? { x: round(node.position.x), y: round(node.position.y) } : auto);
    });
  }

  const trigger = nodes.find((node) => isTriggerType(node.type));
  const reachable = trigger ? reachableFrom(structural, trigger.id) : new Set<string>();

  const errorCounts = new Map<string, number>();
  const warningCounts = new Map<string, number>();
  for (const issue of issues) {
    if (!issue.nodeId) continue;
    const bucket = issue.severity === "error" ? errorCounts : warningCounts;
    bucket.set(issue.nodeId, (bucket.get(issue.nodeId) ?? 0) + 1);
  }

  const previewNodes: PreviewNode[] = ids.map((id) => {
    const node = byId.get(id) as WorkflowNode;
    const nodeType = NODE_TYPES[node.type];
    const position = placed.get(id) ?? { x: PADDING, y: PADDING };
    const effect = describeNodeEffect(node);
    // With no trigger at all, "unreachable" would be true of every step and
    // would say nothing; the validator already reports the missing trigger.
    const unreachable = Boolean(trigger) && !reachable.has(id);

    return {
      id,
      type: node.type,
      label: node.label.trim() || nodeType.label,
      typeLabel: nodeType.label,
      category: nodeType.category,
      categoryLabel: NODE_CATEGORY_META[nodeType.category]?.label ?? nodeType.category,
      summary: describeNodeConfig(node),
      details: describeNodeDetails(node),
      inputs: nodeType.inputs,
      outputs: nodeType.outputs,
      effect,
      tags: tagsFor(node, effect, unreachable),
      isTrigger: isTriggerType(node.type),
      isBranch: isBranchType(node.type),
      isTerminal: nodeType.outputs.length === 0,
      unreachable,
      errorCount: errorCounts.get(id) ?? 0,
      warningCount: warningCounts.get(id) ?? 0,
      state: options.states?.[id] ?? "idle",
      x: position.x,
      y: position.y,
      width: PREVIEW_NODE_WIDTH,
      height: PREVIEW_NODE_HEIGHT,
      rank: rank.get(id) ?? 0,
      column: column.get(id) ?? 0,
    };
  });

  const previewNodeById = new Map(previewNodes.map((node) => [node.id, node]));

  const previewEdges: PreviewEdge[] = edges.map((edge) => {
    const source = placed.get(edge.from) ?? { x: 0, y: 0 };
    const target = placed.get(edge.to) ?? { x: 0, y: 0 };
    // Structural, not geometric: the edge that closes a loop is drawn as a
    // return path even if an explicit layout happens to place it downwards.
    const back = backEdgeIds.has(edge.id) || target.y <= source.y;
    const geometry = edgePath(source, target, back);
    const sourceNode = byId.get(edge.from);
    const port = sourceNode
      ? NODE_TYPES[sourceNode.type].outputs.find((candidate) => candidate.id === edge.condition)
      : undefined;
    return {
      id: edge.id,
      from: edge.from,
      to: edge.to,
      condition: edge.condition,
      label: edge.condition === "default" ? null : (port?.label ?? edge.condition),
      path: geometry.path,
      labelX: geometry.labelX,
      labelY: geometry.labelY,
      back,
    };
  });

  const summary: PreviewSummaryStep[] = ids.map((id, index) => {
    const node = previewNodeById.get(id) as PreviewNode;
    const next = previewEdges
      .filter((edge) => edge.from === id)
      .map((edge) => ({
        label: previewNodeById.get(edge.to)?.label ?? edge.to,
        outcome: edge.label,
      }));
    return {
      index: index + 1,
      nodeId: id,
      label: node.label,
      typeLabel: node.typeLabel,
      categoryLabel: node.categoryLabel,
      summary: node.summary,
      effect: node.effect,
      unreachable: node.unreachable,
      next,
    };
  });

  const width = round(Math.max(...previewNodes.map((node) => node.x + node.width)) + PADDING);
  const height = round(Math.max(...previewNodes.map((node) => node.y + node.height)) + PADDING);

  return { nodes: previewNodes, edges: previewEdges, summary, issues, droppedEdgeIds, width, height, empty: false };
}

/* -------------------------------------------------------------------------- */
/* Neighbourhood highlighting                                                 */
/* -------------------------------------------------------------------------- */

export interface PreviewNeighbourhood {
  /** The selected node, its ancestors and its descendants. */
  nodeIds: ReadonlySet<string>;
  edgeIds: ReadonlySet<string>;
  upstream: ReadonlySet<string>;
  downstream: ReadonlySet<string>;
}

/**
 * Everything that flows into, and out of, one node. Selecting a step dims the
 * rest of the graph, which is how a large workflow stays readable.
 */
export function neighbourhoodOf(graph: PreviewGraph, nodeId: string | null): PreviewNeighbourhood | null {
  if (!nodeId || !graph.nodes.some((node) => node.id === nodeId)) return null;

  const walk = (forward: boolean): Set<string> => {
    const seen = new Set<string>();
    const stack = [nodeId];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) continue;
      for (const edge of graph.edges) {
        const from = forward ? edge.from : edge.to;
        const to = forward ? edge.to : edge.from;
        if (from !== current || seen.has(to)) continue;
        seen.add(to);
        stack.push(to);
      }
    }
    seen.delete(nodeId);
    return seen;
  };

  const upstream = walk(false);
  const downstream = walk(true);
  const nodeIds = new Set<string>([nodeId, ...upstream, ...downstream]);
  const edgeIds = new Set(graph.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to)).map((edge) => edge.id));
  return { nodeIds, edgeIds, upstream, downstream };
}
