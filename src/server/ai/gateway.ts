import "server-only";

import type { AiToolDefinition, ChatMessage, ChatStreamEvent, RetrievedSource } from "@/types/ai";

export interface ChatCompletionRequest {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Retrieved knowledge to ground the answer and cite. */
  sources?: RetrievedSource[];
  /**
   * Tools the model may call on this request.
   *
   * Required for a tool call to happen at all: a provider emits one only for a
   * tool declared here, so describing tools in the system prompt alone makes
   * them unreachable. Omitted means no tool calling.
   */
  tools?: AiToolDefinition[];
  /** Opaque metadata forwarded to the gateway for tracing (never secrets). */
  metadata?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * The application's AI boundary. UI and feature code never talk to an LLM
 * vendor directly; they call a gateway which streams normalized events. The
 * production implementation targets Cloudflare AI Gateway (OpenAI-compatible),
 * and a mock implementation keeps local development free of external calls.
 */
export interface AiGateway {
  readonly provider: string;
  streamChat(request: ChatCompletionRequest): AsyncIterable<ChatStreamEvent>;
}

/** Embedding boundary for the RAG pipeline (provider-agnostic). */
export interface EmbeddingProvider {
  readonly provider: string;
  readonly dimensions: number;
  embed(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}
