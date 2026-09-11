import { describe, expect, it } from "vitest";

import { chunkText, estimateTokens, normalizeSourceText } from "@/features/knowledge/chunking";

/** Roughly `tokens` tokens of prose made of distinct sentences. */
function sentences(count: number, wordsPerSentence = 12): string {
  return Array.from({ length: count }, (_, index) => {
    const words = Array.from({ length: wordsPerSentence }, (_, word) => `w${index}x${word}`);
    return `${words.join(" ")}.`;
  }).join(" ");
}

describe("estimateTokens", () => {
  it("is zero for blank input and scales with length", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("   \n  ")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});

describe("normalizeSourceText", () => {
  it("collapses runs of whitespace but keeps paragraph breaks", () => {
    const input = "First   line\r\n\r\n\r\n\r\nSecond\tline  ";
    expect(normalizeSourceText(input)).toBe("First line\n\nSecond line");
  });

  it("removes non-breaking and zero-width characters", () => {
    expect(normalizeSourceText("a\u00a0b\u200bc\ufeff")).toBe("a bc");
  });
});

describe("chunkText", () => {
  it("returns nothing for empty or whitespace-only input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  \t ")).toEqual([]);
  });

  it("keeps short text as a single chunk with sequential positions", () => {
    const chunks = chunkText("A short paragraph about refunds.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.position).toBe(0);
    expect(chunks[0]?.content).toBe("A short paragraph about refunds.");
    expect(chunks[0]?.tokenCount).toBeGreaterThan(0);
  });

  it("never exceeds the token budget and numbers chunks in order", () => {
    const chunks = chunkText(sentences(400), { targetTokens: 100, overlapTokens: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const [index, chunk] of chunks.entries()) {
      expect(chunk.position).toBe(index);
      expect(chunk.tokenCount).toBeLessThanOrEqual(100);
    }
  });

  it("overlaps consecutive chunks so a fact on a boundary survives", () => {
    const chunks = chunkText(sentences(200), { targetTokens: 120, overlapTokens: 40 });
    expect(chunks.length).toBeGreaterThan(2);
    const first = chunks[0]?.content.split(/(?<=\.)\s+/) ?? [];
    const second = chunks[1]?.content.split(/(?<=\.)\s+/) ?? [];
    expect(first.length).toBeGreaterThan(1);
    // The head of chunk N+1 repeats the tail of chunk N, and no sentence is lost.
    expect(first).toContain(second[0]);
    expect(second).toContain(first.at(-1));
  });

  it("omits overlap when a chunk holds a single indivisible segment", () => {
    // Two paragraphs that each fill the budget on their own: repeating either
    // would make no progress, so the chunks must be disjoint.
    const paragraph = sentences(1, 60);
    const chunks = chunkText(`${paragraph}\n\n${paragraph.replace(/w0/g, "z0")}`, {
      targetTokens: estimateTokens(paragraph),
      overlapTokens: 50,
    });
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.content).not.toContain("z0");
    expect(chunks[1]?.content).not.toContain("w0x");
  });

  it("splits on paragraph boundaries before sentence boundaries", () => {
    const text = "Paragraph one is here.\n\nParagraph two is here.\n\nParagraph three is here.";
    const chunks = chunkText(text, { targetTokens: 8, overlapTokens: 0 });
    expect(chunks.length).toBe(3);
    expect(chunks[0]?.content).toBe("Paragraph one is here.");
    expect(chunks[1]?.content).toBe("Paragraph two is here.");
  });

  it("preserves the paragraph break when two paragraphs share a chunk", () => {
    const chunks = chunkText("Alpha beta.\n\nGamma delta.", { targetTokens: 500 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toBe("Alpha beta.\n\nGamma delta.");
  });

  it("hard-splits a sentence that is larger than one chunk", () => {
    const oneSentence = `${Array.from({ length: 300 }, (_, i) => `word${i}`).join(" ")}.`;
    const chunks = chunkText(oneSentence, { targetTokens: 60, overlapTokens: 10 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.tokenCount).toBeLessThanOrEqual(60);
    expect(chunks.some((chunk) => chunk.content.includes("word0"))).toBe(true);
    expect(chunks.some((chunk) => chunk.content.includes("word299"))).toBe(true);
  });

  it("splits a single word longer than a chunk on character boundaries", () => {
    const chunks = chunkText("x".repeat(1000), { targetTokens: 25, overlapTokens: 5 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.content).join("")).toContain("x".repeat(100));
  });

  it("handles a huge document in one pass without runaway chunk counts", () => {
    const huge = sentences(6_000);
    const chunks = chunkText(huge);
    expect(chunks.length).toBeGreaterThan(10);
    // With ~800-token chunks and ~100 tokens of overlap the count stays within
    // a small factor of size / (target - overlap).
    const totalTokens = estimateTokens(huge);
    expect(chunks.length).toBeLessThan((totalTokens / 700) * 1.5 + 5);
    for (const chunk of chunks) expect(chunk.tokenCount).toBeLessThanOrEqual(800);
  });

  it("clamps an overlap that is larger than the target", () => {
    const chunks = chunkText(sentences(50), { targetTokens: 40, overlapTokens: 400 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.tokenCount).toBeLessThanOrEqual(40);
  });
});
