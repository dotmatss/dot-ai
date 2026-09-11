import "server-only";

import { createHash } from "node:crypto";

import { DEFAULT_EMBEDDING_CONFIG } from "@/features/knowledge/constants";
import type { EmbeddingProvider } from "@/server/ai/gateway";

/**
 * Embedding boundary for the knowledge pipeline.
 *
 * The pipeline only ever sees the shared `EmbeddingProvider` interface, so a
 * hosted provider can be dropped in without touching any caller: swap what
 * `getEmbeddingProvider()` returns (or pass an explicit provider to
 * `processSource`, which is how tests inject one).
 */

/** Batches keep request sizes bounded once a network-backed provider is used. */
export const EMBEDDING_BATCH_SIZE = 32;

/**
 * Deterministic, dependency-free provider used in development and tests.
 *
 * It is a feature-hashing ("hashing trick") encoder: every token is hashed to a
 * dimension and a sign, contributions are summed, and the vector is L2
 * normalized. That yields stable vectors with real lexical signal — identical
 * text always produces an identical vector and similar text produces similar
 * vectors — without any external call. It is not a semantic model and is not a
 * substitute for one in production.
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly provider = "mock";
  readonly dimensions: number;

  constructor(options: { dimensions?: number } = {}) {
    this.dimensions = Math.max(8, Math.floor(options.dimensions ?? DEFAULT_EMBEDDING_CONFIG.dimensions));
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.vectorFor(text));
  }

  private vectorFor(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0);
    const tokens = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    for (const token of tokens) {
      const digest = createHash("sha256").update(token).digest();
      // 4 bytes for the dimension, 1 bit of the next byte for the sign.
      const index = digest.readUInt32BE(0) % this.dimensions;
      const sign = (digest[4] ?? 0) & 1 ? -1 : 1;
      const current = vector[index] ?? 0;
      vector[index] = current + sign;
    }
    const norm = Math.sqrt(vector.reduce((total, value) => total + value * value, 0));
    if (norm === 0) return vector;
    return vector.map((value) => value / norm);
  }
}

let provider: EmbeddingProvider | undefined;

/**
 * Single resolution point for the embedding provider. Only the mock exists
 * today; selecting a hosted provider belongs here and would read its
 * configuration through `src/config/env.ts` like the AI gateway does.
 */
export function getEmbeddingProvider(): EmbeddingProvider {
  provider ??= new MockEmbeddingProvider();
  return provider;
}
