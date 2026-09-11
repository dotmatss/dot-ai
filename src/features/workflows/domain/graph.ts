/**
 * Graph helpers shared by the validator, the builder and the executor.
 *
 * They work on structural shapes rather than the definition type so this
 * module has no imports and therefore no cycle with `definition.ts`.
 */

export interface GraphNodeLike {
  id: string;
}

export interface GraphEdgeLike {
  id: string;
  from: string;
  to: string;
  condition?: "true" | "false" | "default";
}

export interface GraphLike {
  nodes: ReadonlyArray<GraphNodeLike>;
  edges: ReadonlyArray<GraphEdgeLike>;
}

export function outgoingEdges<E extends GraphEdgeLike>(graph: { edges: ReadonlyArray<E> }, nodeId: string): E[] {
  return graph.edges.filter((edge) => edge.from === nodeId);
}

export function incomingEdges<E extends GraphEdgeLike>(graph: { edges: ReadonlyArray<E> }, nodeId: string): E[] {
  return graph.edges.filter((edge) => edge.to === nodeId);
}

/** Edges that continue the main sequence (a branch uses "true"/"false" instead). */
export function defaultOutgoingEdges<E extends GraphEdgeLike>(graph: { edges: ReadonlyArray<E> }, nodeId: string): E[] {
  return outgoingEdges(graph, nodeId).filter((edge) => edge.condition === undefined || edge.condition === "default");
}

export interface TopologicalResult {
  /** Node ids in dependency order; nodes that belong to a cycle are omitted. */
  order: string[];
  /** Node ids that could not be ordered because they sit in (or after) a cycle. */
  cycle: string[];
}

/**
 * Kahn's algorithm. Edges pointing at unknown nodes are ignored so a dangling
 * edge is reported once by the validator instead of corrupting the order.
 */
export function topologicalOrder(graph: GraphLike): TopologicalResult {
  const ids = graph.nodes.map((node) => node.id);
  const known = new Set(ids);
  const edges = graph.edges.filter((edge) => known.has(edge.from) && known.has(edge.to) && edge.from !== edge.to);

  const indegree = new Map<string, number>(ids.map((id) => [id, 0]));
  const adjacency = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const edge of edges) {
    adjacency.get(edge.from)?.push(edge.to);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }

  const queue = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) break;
    order.push(id);
    for (const next of adjacency.get(id) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }

  const ordered = new Set(order);
  return { order, cycle: ids.filter((id) => !ordered.has(id)) };
}

/** Node ids reachable from `startId`, including the start node itself. */
export function reachableFrom(graph: GraphLike, startId: string): Set<string> {
  const known = new Set(graph.nodes.map((node) => node.id));
  const seen = new Set<string>();
  if (!known.has(startId)) return seen;
  const stack = [startId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    for (const edge of graph.edges) {
      if (edge.from === id && known.has(edge.to) && !seen.has(edge.to)) stack.push(edge.to);
    }
  }
  return seen;
}

/**
 * Steps in the order the builder shows them: topological where possible, with
 * cycle members appended so an invalid graph is still fully editable.
 */
export function displayOrder(graph: GraphLike): string[] {
  const { order, cycle } = topologicalOrder(graph);
  return [...order, ...cycle];
}
