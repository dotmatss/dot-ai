import "server-only";

import type { ChatMessage, ChatStreamEvent } from "@/types/ai";

import type { AiGateway, ChatCompletionRequest } from "./gateway";

interface OpenAiCompatibleOptions {
  baseUrl: string;
  apiKey?: string;
  defaultModel: string;
  /** Extra headers, e.g. Cloudflare AI Gateway metadata. */
  headers?: Record<string, string>;
}

interface StreamChunk {
  id?: string;
  model?: string;
  choices?: Array<{
    delta?: { content?: string | null; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  error?: { message?: string; code?: string };
}

/** One message in the provider's wire shape. */
interface WireMessage {
  role: string;
  content: string;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

/**
 * Maps our message onto the provider's.
 *
 * The two tool-related shapes are not decoration. A provider rejects a `tool`
 * message that does not carry the `tool_call_id` of a call it can see, and it
 * cannot see the call unless the preceding assistant message repeats it. A
 * multi-step tool exchange therefore has to replay both halves.
 */
function toWireMessage(message: ChatMessage): WireMessage {
  if (message.role === "tool") {
    return { role: "tool", content: message.content, ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}) };
  }
  if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: {
          name: call.name,
          // Always a string on the wire, even when we parsed it on the way in.
          arguments: typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments ?? {}),
        },
      })),
    };
  }
  return { role: message.role, content: message.content };
}

/**
 * Streams chat completions from any OpenAI-compatible endpoint. Intended to be
 * pointed at Cloudflare AI Gateway, which fronts the actual model provider and
 * adds caching, rate limiting, logging and cost controls at the edge.
 */
export class OpenAiCompatibleGateway implements AiGateway {
  readonly provider = "gateway";

  constructor(private readonly options: OpenAiCompatibleOptions) {}

  async *streamChat(request: ChatCompletionRequest): AsyncIterable<ChatStreamEvent> {
    const model = request.model ?? this.options.defaultModel;
    const messages = [...request.messages];

    if (request.sources && request.sources.length > 0) {
      const context = request.sources
        .map((source, index) => `[${index + 1}] ${source.title}\n${source.snippet}`)
        .join("\n\n");
      messages.splice(messages.findIndex((m) => m.role !== "system"), 0, {
        role: "system",
        content: `Use the following knowledge excerpts when relevant and cite them as [n].\n\n${context}`,
      });
      yield { type: "sources", sources: request.sources };
    }

    const response = await fetch(`${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: request.signal,
      headers: {
        "Content-Type": "application/json",
        ...(this.options.apiKey ? { Authorization: `Bearer ${this.options.apiKey}` } : {}),
        ...(request.metadata ? { "cf-aig-metadata": JSON.stringify(request.metadata) } : {}),
        ...this.options.headers,
      },
      body: JSON.stringify({
        model,
        messages: messages.map(toWireMessage),
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
        // Only sent when there is something to call. `auto` rather than
        // `required`: the model must stay free to answer without a tool.
        ...(request.tools && request.tools.length > 0
          ? {
              tools: request.tools.map((tool) => ({
                type: "function",
                function: { name: tool.name, description: tool.description, parameters: tool.parameters },
              })),
              tool_choice: "auto",
            }
          : {}),
      }),
    });

    if (!response.ok || !response.body) {
      // The body can carry provider internals - model names, quota details,
      // sometimes fragments of the prompt - and this stream is read by
      // anonymous widget visitors. Log it, return something safe.
      const text = await response.text().catch(() => "");
      console.error(`[ai] gateway responded with ${response.status}: ${text.slice(0, 500)}`);
      yield {
        type: "error",
        message: response.status === 429 ? "The assistant is busy right now. Please try again shortly." : "The assistant is unavailable right now.",
        code: response.status === 429 ? "rate_limited" : "unavailable",
      };
      yield { type: "done", finishReason: "error" };
      return;
    }

    yield { type: "start", id: response.headers.get("x-request-id") ?? `gw_${Date.now().toString(36)}`, model };

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finish: ChatStreamEvent | null = null;
    const toolCalls = new Map<number, { id: string; name: string; args: string }>();

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n");
        while (boundary !== -1) {
          const line = buffer.slice(0, boundary).trim();
          buffer = buffer.slice(boundary + 1);
          boundary = buffer.indexOf("\n");
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;
          let chunk: StreamChunk;
          try {
            chunk = JSON.parse(payload) as StreamChunk;
          } catch {
            continue;
          }
          if (chunk.error) {
            console.error("[ai] gateway stream error", chunk.error);
            yield { type: "error", message: "The assistant could not finish this reply.", code: "unavailable" };
            finish = { type: "done", finishReason: "error" };
            continue;
          }
          const choice = chunk.choices?.[0];
          const delta = choice?.delta;
          if (delta?.content) yield { type: "text-delta", delta: delta.content };
          if (delta?.tool_calls) {
            delta.tool_calls.forEach((call, index) => {
              const existing = toolCalls.get(index) ?? { id: call.id ?? `call_${index}`, name: "", args: "" };
              existing.name = call.function?.name ?? existing.name;
              existing.args += call.function?.arguments ?? "";
              toolCalls.set(index, existing);
            });
          }
          if (chunk.usage) {
            yield {
              type: "usage",
              usage: { inputTokens: chunk.usage.prompt_tokens ?? 0, outputTokens: chunk.usage.completion_tokens ?? 0 },
            };
          }
          if (choice?.finish_reason) {
            const reason = choice.finish_reason;
            finish = {
              type: "done",
              finishReason: reason === "length" ? "length" : reason === "tool_calls" ? "tool_calls" : "stop",
            };
          }
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        yield { type: "done", finishReason: "cancelled" };
        return;
      }
      yield { type: "error", message: error instanceof Error ? error.message : "Stream failed" };
      yield { type: "done", finishReason: "error" };
      return;
    } finally {
      reader.releaseLock();
    }

    for (const call of toolCalls.values()) {
      let parsed: unknown = call.args;
      try {
        parsed = JSON.parse(call.args);
      } catch {
        // leave raw string
      }
      yield { type: "tool-call", id: call.id, name: call.name, arguments: parsed };
    }

    yield finish ?? { type: "done", finishReason: "stop" };
  }
}
