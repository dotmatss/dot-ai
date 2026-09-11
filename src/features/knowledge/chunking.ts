/**
 * Text chunking for the RAG pipeline.
 *
 * Pure, dependency-free and shared by the server pipeline and unit tests.
 * Retrieval quality depends far more on chunk boundaries than on the vector
 * store, so the splitter prefers paragraph boundaries, then sentence
 * boundaries, and only hard-splits when a single sentence is larger than one
 * chunk. Consecutive chunks overlap so a fact that straddles a boundary is
 * still fully present in at least one chunk.
 */

export const CHUNK_TARGET_TOKENS = 800;
export const CHUNK_OVERLAP_TOKENS = 100;

/**
 * Tokenizer-free size estimate (~4 characters per token for English prose).
 * Chunk sizes only need to be stable and roughly right; exact accounting
 * belongs to the provider that actually tokenizes the text.
 */
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.ceil(trimmed.length / CHARS_PER_TOKEN);
}

export interface TextChunk {
  position: number;
  content: string;
  tokenCount: number;
}

export interface ChunkOptions {
  targetTokens?: number;
  overlapTokens?: number;
}

/** Collapses whitespace without destroying paragraph structure. */
export function normalizeSourceText(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    // Zero-width characters survive copy-paste from PDFs and rich editors and
    // corrupt both token estimates and full-text search.
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface Segment {
  text: string;
  tokens: number;
  /** Index of the paragraph the segment came from, used to rebuild breaks. */
  block: number;
}

const SENTENCE_BOUNDARY = /(?<=[.!?…]["')\]]?)\s+(?=[^\s])/u;

function splitOversizedSentence(sentence: string, maxTokens: number): string[] {
  const maxChars = Math.max(1, maxTokens * CHARS_PER_TOKEN);
  const words = sentence.split(" ").filter(Boolean);
  const parts: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && candidate.length > maxChars) {
      parts.push(current);
      current = word;
      continue;
    }
    // A single word longer than a whole chunk (minified data, long URLs) is cut
    // on character boundaries rather than dropped.
    if (!current && word.length > maxChars) {
      for (let index = 0; index < word.length; index += maxChars) {
        parts.push(word.slice(index, index + maxChars));
      }
      current = "";
      continue;
    }
    current = candidate;
  }
  if (current) parts.push(current);
  return parts;
}

function toSegments(text: string, targetTokens: number): Segment[] {
  const segments: Segment[] = [];
  const blocks = text.split(/\n{2,}/);
  blocks.forEach((block, blockIndex) => {
    const paragraph = block.trim();
    if (!paragraph) return;
    const paragraphTokens = estimateTokens(paragraph);
    if (paragraphTokens <= targetTokens) {
      segments.push({ text: paragraph, tokens: paragraphTokens, block: blockIndex });
      return;
    }
    for (const sentence of paragraph.split(SENTENCE_BOUNDARY)) {
      const trimmed = sentence.trim();
      if (!trimmed) continue;
      const tokens = estimateTokens(trimmed);
      if (tokens <= targetTokens) {
        segments.push({ text: trimmed, tokens, block: blockIndex });
        continue;
      }
      for (const part of splitOversizedSentence(trimmed, targetTokens)) {
        segments.push({ text: part, tokens: estimateTokens(part), block: blockIndex });
      }
    }
  });
  return segments;
}

function joinSegments(segments: Segment[]): string {
  return segments
    .map((segment, index) => {
      if (index === 0) return segment.text;
      const previous = segments[index - 1];
      return previous && previous.block !== segment.block ? `\n\n${segment.text}` : ` ${segment.text}`;
    })
    .join("");
}

/**
 * Trailing segments to repeat at the start of the next chunk. At least one
 * segment is always left behind so the walk cannot stall on a chunk that is
 * entirely overlap.
 */
function overlapSegments(chunk: Segment[], overlapTokens: number): Segment[] {
  if (overlapTokens <= 0 || chunk.length <= 1) return [];
  const carried: Segment[] = [];
  let tokens = 0;
  for (let index = chunk.length - 1; index >= 1; index--) {
    const segment = chunk[index];
    if (!segment) break;
    if (carried.length > 0 && tokens + segment.tokens > overlapTokens) break;
    carried.unshift(segment);
    tokens += segment.tokens;
    if (tokens >= overlapTokens) break;
  }
  return carried;
}

/**
 * Splits text into overlapping chunks of at most `targetTokens` estimated
 * tokens. `tokenCount` is the sum of the segment estimates the packer used, so
 * it is always within the budget the caller asked for.
 */
export function chunkText(input: string, options: ChunkOptions = {}): TextChunk[] {
  const targetTokens = Math.max(1, Math.floor(options.targetTokens ?? CHUNK_TARGET_TOKENS));
  const overlapTokens = Math.max(0, Math.min(Math.floor(options.overlapTokens ?? CHUNK_OVERLAP_TOKENS), targetTokens - 1));

  const normalized = normalizeSourceText(input);
  if (!normalized) return [];

  const segments = toSegments(normalized, targetTokens);
  if (segments.length === 0) return [];

  const chunks: TextChunk[] = [];
  let current: Segment[] = [];
  let currentTokens = 0;

  const flush = () => {
    if (current.length === 0) return;
    chunks.push({ position: chunks.length, content: joinSegments(current), tokenCount: currentTokens });
  };

  for (const segment of segments) {
    if (current.length > 0 && currentTokens + segment.tokens > targetTokens) {
      flush();
      current = overlapSegments(current, overlapTokens);
      currentTokens = current.reduce((total, item) => total + item.tokens, 0);
    }
    current.push(segment);
    currentTokens += segment.tokens;
  }
  flush();

  return chunks;
}
