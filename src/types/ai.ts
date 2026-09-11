/**
 * Provider-agnostic AI contracts shared by the server AI boundary and client
 * streaming UI. Nothing here references a specific LLM vendor.
 */

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** A retrieved knowledge chunk surfaced as a citation. */
export interface RetrievedSource {
  id: string;
  title: string;
  snippet: string;
  uri?: string | null;
  score?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export type FinishReason = "stop" | "length" | "tool_calls" | "cancelled" | "error";

export type ChatStreamEvent =
  | { type: "start"; id: string; model: string }
  | { type: "text-delta"; delta: string }
  | { type: "sources"; sources: RetrievedSource[] }
  | { type: "tool-call"; id: string; name: string; arguments: unknown }
  | { type: "tool-result"; id: string; result: unknown }
  | { type: "usage"; usage: TokenUsage }
  | { type: "done"; finishReason: FinishReason }
  | { type: "error"; message: string; code?: string };

export interface ModelConfig {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}
