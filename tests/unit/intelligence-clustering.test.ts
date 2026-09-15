import { describe, expect, it } from "vitest";

import {
  assignToCluster,
  cosineSimilarity,
  foldIntoCluster,
  magnitude,
  nearestCluster,
  normalize,
  type Cluster,
} from "@/features/intelligence/clustering";

const cluster = (centroid: number[], size = 1): Cluster => ({ centroid, size });

describe("normalize", () => {
  it("scales a vector to unit length", () => {
    expect(magnitude(normalize([3, 4]))).toBeCloseTo(1, 10);
  });

  it("returns a zero vector unchanged rather than producing NaNs", () => {
    // A NaN here would poison every similarity the centroid is ever compared
    // against, and would do it silently.
    expect(normalize([0, 0, 0])).toEqual([0, 0, 0]);
  });
});

describe("cosineSimilarity", () => {
  it("scores identical directions as 1 regardless of magnitude", () => {
    expect(cosineSimilarity([1, 0], [5, 0])).toBeCloseTo(1, 10);
  });

  it("scores orthogonal vectors as 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it("scores opposing directions as -1", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 10);
  });

  it("refuses to compare vectors from different spaces", () => {
    // Comparing the overlapping prefix would return a plausible number for an
    // incomparable pair, which is worse than saying "not similar".
    expect(cosineSimilarity([1, 0, 0], [1, 0])).toBe(0);
  });

  it("returns 0 for a zero vector instead of NaN", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it("never exceeds 1 through floating-point error", () => {
    const vector = normalize([0.1, 0.2, 0.3]);
    expect(cosineSimilarity(vector, vector)).toBeLessThanOrEqual(1);
  });

  it("returns 0 for empty vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });
});

describe("nearestCluster", () => {
  const clusters = [cluster([1, 0]), cluster([0, 1])];

  it("finds the closest cluster above the threshold", () => {
    const result = nearestCluster([0.9, 0.1], clusters, 0.5);
    expect(result?.index).toBe(0);
  });

  it("returns null when nothing is near enough", () => {
    expect(nearestCluster([0.71, 0.71], clusters, 0.95)).toBeNull();
  });

  it("breaks ties towards the earlier cluster, which is the older topic", () => {
    const tied = [cluster([1, 0]), cluster([1, 0])];
    expect(nearestCluster([1, 0], tied, 0.5)?.index).toBe(0);
  });

  it("returns null when there are no clusters at all", () => {
    expect(nearestCluster([1, 0], [], 0)).toBeNull();
  });
});

describe("foldIntoCluster", () => {
  it("moves the centroid towards the new member and keeps it normalized", () => {
    const folded = foldIntoCluster(cluster([1, 0], 1), [0, 1]);
    expect(magnitude(folded.centroid)).toBeCloseTo(1, 10);
    expect(folded.size).toBe(2);
    expect(folded.centroid[0]).toBeCloseTo(folded.centroid[1] ?? 0, 10);
  });

  it("moves less as the cluster grows", () => {
    const small = foldIntoCluster(cluster([1, 0], 1), [0, 1]);
    const large = foldIntoCluster(cluster([1, 0], 100), [0, 1]);
    expect(large.centroid[1] ?? 0).toBeLessThan(small.centroid[1] ?? 0);
  });

  it("refuses a vector from another space rather than truncating", () => {
    const original = cluster([1, 0], 3);
    expect(foldIntoCluster(original, [1, 0, 0])).toBe(original);
  });
});

describe("assignToCluster", () => {
  const base = { threshold: 0.6, maxClusters: 10 };

  it("joins a cluster it is close enough to", () => {
    const result = assignToCluster({ ...base, vector: [1, 0.1], clusters: [cluster([1, 0])] });
    expect(result.kind).toBe("joined");
  });

  it("founds a new cluster when nothing is close enough", () => {
    const result = assignToCluster({ ...base, vector: [0, 1], clusters: [cluster([1, 0])] });
    expect(result.kind).toBe("created");
  });

  it("founds the first cluster when there are none", () => {
    expect(assignToCluster({ ...base, vector: [1, 0], clusters: [] }).kind).toBe("created");
  });

  it("forces a weak match once the topic cap is reached", () => {
    // At the cap the alternatives are to drop the conversation from the
    // analysis - making every count quietly wrong - or to file it under its
    // nearest neighbour and record how weak the match was.
    const result = assignToCluster({
      vector: [0, 1],
      clusters: [cluster([1, 0])],
      threshold: 0.6,
      maxClusters: 1,
    });
    expect(result.kind).toBe("forced");
    if (result.kind === "forced") expect(result.similarity).toBeLessThan(0.6);
  });

  it("skips a zero vector instead of assigning it arbitrarily", () => {
    // A zero vector is equally dissimilar to everything, so it would land in
    // whichever cluster it happened to be compared against first.
    expect(assignToCluster({ ...base, vector: [0, 0], clusters: [cluster([1, 0])] }).kind).toBe("skipped");
  });

  it("skips an empty vector", () => {
    expect(assignToCluster({ ...base, vector: [], clusters: [cluster([1, 0])] }).kind).toBe("skipped");
  });
});

describe("incremental behaviour across runs", () => {
  it("keeps existing clusters rather than reshuffling them", () => {
    // The property that makes topic ids stable week to week, and the reason
    // this is leader clustering and not k-means.
    let clusters = [cluster([1, 0], 5)];
    const assignment = assignToCluster({
      vector: normalize([0.95, 0.05]),
      clusters,
      threshold: 0.6,
      maxClusters: 10,
    });
    expect(assignment.kind).toBe("joined");
    if (assignment.kind !== "joined") return;
    clusters = [foldIntoCluster(clusters[0]!, normalize([0.95, 0.05]))];
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.size).toBe(6);
  });
});
