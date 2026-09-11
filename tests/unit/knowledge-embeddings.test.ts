import { describe, expect, it } from "vitest";

import { MockEmbeddingProvider } from "@/features/knowledge/server/embeddings";

const provider = new MockEmbeddingProvider();

function magnitude(vector: number[]): number {
  return Math.sqrt(vector.reduce((total, value) => total + value * value, 0));
}

function cosine(a: number[], b: number[]): number {
  return a.reduce((total, value, index) => total + value * (b[index] ?? 0), 0);
}

describe("MockEmbeddingProvider", () => {
  it("satisfies the shared EmbeddingProvider contract", () => {
    expect(provider.provider).toBe("mock");
    expect(provider.dimensions).toBe(256);
    expect(new MockEmbeddingProvider({ dimensions: 64 }).dimensions).toBe(64);
    // A degenerate dimension count would make every vector collide.
    expect(new MockEmbeddingProvider({ dimensions: 1 }).dimensions).toBe(8);
  });

  it("returns one unit vector of the declared size per input", async () => {
    const vectors = await provider.embed(["refund policy", "shipping times"]);
    expect(vectors).toHaveLength(2);
    for (const vector of vectors) {
      expect(vector).toHaveLength(256);
      expect(magnitude(vector)).toBeCloseTo(1, 6);
    }
  });

  it("is deterministic across calls and instances", async () => {
    const [first] = await provider.embed(["Refunds are processed within 30 days."]);
    const [second] = await new MockEmbeddingProvider().embed(["Refunds are processed within 30 days."]);
    expect(first).toEqual(second);
  });

  it("ignores case and punctuation but not wording", async () => {
    const [lower] = await provider.embed(["refund policy"]);
    const [upper] = await provider.embed(["  Refund, POLICY!  "]);
    const [other] = await provider.embed(["shipping estimate"]);
    expect(lower).toEqual(upper);
    expect(lower).not.toEqual(other);
  });

  it("scores lexically similar text above unrelated text", async () => {
    const [query, similar, unrelated] = await provider.embed([
      "how do I request a refund",
      "to request a refund open the billing page",
      "our offices are closed on public holidays",
    ]);
    expect(cosine(query!, similar!)).toBeGreaterThan(cosine(query!, unrelated!));
  });

  it("returns a zero vector for text with no tokens", async () => {
    const [vector] = await provider.embed(["   ---   "]);
    expect(magnitude(vector!)).toBe(0);
  });

  it("returns an empty result for an empty batch", async () => {
    expect(await provider.embed([])).toEqual([]);
  });
});
