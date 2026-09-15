/**
 * Incremental clustering of question vectors into topics.
 *
 * Pure vector maths, no database and no provider: the analysis run supplies
 * vectors and existing centroids, this decides where each question belongs.
 * Keeping it pure is what makes the behaviour testable without an embedding
 * model, a workspace, or a transaction.
 *
 * THE ALGORITHM, AND WHY THIS ONE
 * -------------------------------
 * Single-pass nearest-centroid assignment (sequential leader clustering):
 * compare each question to every existing centroid, join the best one if it
 * clears the threshold, otherwise found a new topic. It is O(n x k) and, more
 * importantly, it is *incremental* - tomorrow's run extends today's topics
 * instead of renaming everything, so a topic a customer has been watching does
 * not silently become a different topic overnight.
 *
 * k-means would produce tidier clusters and is the wrong tool here: it needs k
 * up front, it is not stable across runs, and re-running it would reshuffle
 * every topic id. Stability across runs is worth more than cluster quality when
 * the output is a list somebody reads every week.
 *
 * The cost is order sensitivity - the first question to raise a subject founds
 * its topic - which is why `listConversationsForAnalysis` returns oldest first.
 */

/** L2 norm. Exported for tests; callers normally want `normalize`. */
export function magnitude(vector: ReadonlyArray<number>): number {
  let total = 0;
  for (const value of vector) total += value * value;
  return Math.sqrt(total);
}

/**
 * Scales a vector to unit length. A zero vector is returned unchanged - it has
 * no direction to preserve, and dividing by its norm would produce NaNs that
 * then poison every similarity it touches.
 */
export function normalize(vector: ReadonlyArray<number>): number[] {
  const norm = magnitude(vector);
  if (norm === 0) return [...vector];
  return vector.map((value) => value / norm);
}

/**
 * Cosine similarity, guarded.
 *
 * Vectors of different lengths mean two embedding spaces have been mixed, and
 * the only safe answer is "not similar": silently comparing the overlapping
 * prefix would return a plausible number for an incomparable pair. A zero
 * vector likewise scores 0 rather than NaN.
 */
export function cosineSimilarity(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let aSquared = 0;
  let bSquared = 0;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    dot += left * right;
    aSquared += left * left;
    bSquared += right * right;
  }
  if (aSquared === 0 || bSquared === 0) return 0;
  const similarity = dot / (Math.sqrt(aSquared) * Math.sqrt(bSquared));
  // Floating-point error can push an identical pair a hair past 1.0, which
  // would then render as "101% match".
  return Math.min(1, Math.max(-1, similarity));
}

export interface Cluster {
  centroid: number[];
  /** Members counted into the centroid, which weights the running mean. */
  size: number;
}

export interface Assignment {
  index: number;
  similarity: number;
}

/**
 * Nearest cluster to `vector`, or null when none is near enough.
 *
 * Ties go to the earlier cluster, which given chronological input means the
 * older topic wins. That keeps assignment deterministic for identical
 * questions instead of depending on iteration order.
 */
export function nearestCluster(
  vector: ReadonlyArray<number>,
  clusters: ReadonlyArray<Cluster>,
  threshold: number,
): Assignment | null {
  let best: Assignment | null = null;
  for (let index = 0; index < clusters.length; index += 1) {
    const cluster = clusters[index];
    if (!cluster) continue;
    const similarity = cosineSimilarity(vector, cluster.centroid);
    if (similarity > (best?.similarity ?? -Infinity)) best = { index, similarity };
  }
  if (!best || best.similarity < threshold) return null;
  return best;
}

/**
 * Folds a new member into a cluster's centroid.
 *
 * A size-weighted running mean, re-normalized: the centroid stays a unit vector
 * so similarities against it are comparable with every other centroid.
 *
 * This is an approximation of the true mean of the members, because the stored
 * centroid was normalized at every previous step and the original magnitudes
 * are gone. That is deliberate - keeping every member vector in memory to
 * compute an exact mean would make the pass O(n) in space for a difference that
 * does not change which cluster anything lands in. Recomputing a centroid
 * exactly is a rebuild, not an increment.
 */
export function foldIntoCluster(cluster: Cluster, vector: ReadonlyArray<number>): Cluster {
  if (cluster.centroid.length !== vector.length) return cluster;
  const size = cluster.size;
  const next = cluster.centroid.map((value, index) => (value * size + (vector[index] ?? 0)) / (size + 1));
  return { centroid: normalize(next), size: size + 1 };
}

export interface ClusterAssignmentInput {
  vector: ReadonlyArray<number>;
  clusters: ReadonlyArray<Cluster>;
  threshold: number;
  /** Once this many clusters exist, no new one is founded. */
  maxClusters: number;
}

export type ClusterAssignmentResult =
  | { kind: "joined"; index: number; similarity: number }
  | { kind: "created"; similarity: null }
  /** At the cap: forced into the nearest cluster, however weak the match. */
  | { kind: "forced"; index: number; similarity: number }
  /** Nothing to join and nothing to create from - an unusable vector. */
  | { kind: "skipped"; similarity: null };

/**
 * Decides what happens to one question vector.
 *
 * The `forced` case is the interesting one. At the topic cap the alternatives
 * are to drop the conversation from the analysis, or to file it under its
 * closest neighbour and record how weak that match was. Dropping it would make
 * the conversation counts quietly wrong; `topic_similarity` is stored precisely
 * so a forced assignment stays visible afterwards.
 */
export function assignToCluster(input: ClusterAssignmentInput): ClusterAssignmentResult {
  if (input.vector.length === 0 || magnitude(input.vector) === 0) return { kind: "skipped", similarity: null };

  const nearest = nearestCluster(input.vector, input.clusters, input.threshold);
  if (nearest) return { kind: "joined", index: nearest.index, similarity: nearest.similarity };

  if (input.clusters.length < input.maxClusters) return { kind: "created", similarity: null };

  // No threshold this time: the cap means "join something" is the only move.
  const fallback = nearestCluster(input.vector, input.clusters, -Infinity);
  if (!fallback) return { kind: "skipped", similarity: null };
  return { kind: "forced", index: fallback.index, similarity: fallback.similarity };
}
