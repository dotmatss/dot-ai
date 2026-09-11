/**
 * Provider-agnostic AI contracts shared by the server AI boundary and client
 * streaming UI. Nothing here references a specific LLM vendor.
 */

export type ChatRole = "system" | "user" | "assistant" | "tool";

/** A tool the model asked for, as it travels back into the next request. */
export interface ChatToolCall {
  id: string;
  name: string;
  /** Arguments as the model produced them. */
  arguments: unknown;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /**
   * Set on an `assistant` message that requested tools. Carried back into the
   * following request because a provider will reject a `tool` result that does
   * not answer a call it can see.
   */
  toolCalls?: ChatToolCall[];
  /** Set on a `tool` message: which call this is the result of. */
  toolCallId?: string;
}

/**
 * A tool offered to the model for this request.
 *
 * Describing a tool in the system prompt is not enough to make it callable —
 * an OpenAI-compatible provider only emits a tool call for a tool declared
 * here. `name` must satisfy the provider's function-name rules (letters,
 * digits, underscore, hyphen; at most 64 characters), which our namespaced
 * references do not, so the caller maps between the two.
 */
export interface AiToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  parameters: Record<string, unknown>;
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
