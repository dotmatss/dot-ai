import "server-only";

import type { ChatStreamEvent } from "@/types/ai";

import type { AiGateway, ChatCompletionRequest } from "./gateway";

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

function composeReply(request: ChatCompletionRequest): string {
  const lastUser = [...request.messages].reverse().find((m) => m.role === "user")?.content.trim() ?? "";
  const system = request.messages.find((m) => m.role === "system")?.content.trim();
  const sources = request.sources ?? [];

  const parts: string[] = [];
  if (!lastUser) {
    parts.push("Hello! Ask me anything and I will do my best to help.");
  } else {
    parts.push(`Thanks for your message. You asked: "${lastUser.slice(0, 160)}${lastUser.length > 160 ? "…" : ""}".`);
    if (sources.length > 0) {
      parts.push(
        `Based on ${sources.length} matching source${sources.length === 1 ? "" : "s"} from the connected knowledge base, here is a grounded answer: ${sources[0]?.snippet ?? ""}`,
      );
      parts.push(sources.map((s, i) => `[${i + 1}] ${s.title}`).join("  "));
    } else {
      parts.push(
        "This is a simulated response from the mock AI gateway. Configure AI_PROVIDER=gateway with Cloudflare AI Gateway credentials to receive real model output.",
      );
    }
  }
  if (system) {
    parts.push(`(Following ${estimateTokens(system)} tokens of instructions.)`);
  }
  return parts.join("\n\n");
}

/**
 * Deterministic, dependency-free gateway used in development and tests. It
 * streams word by word so the full streaming UX can be exercised locally.
 */
export class MockAiGateway implements AiGateway {
  readonly provider = "mock";

  constructor(private readonly options: { delayMs?: number } = {}) {}

  async *streamChat(request: ChatCompletionRequest): AsyncIterable<ChatStreamEvent> {
    const id = `mock_${Date.now().toString(36)}`;
    const model = request.model ?? "mock-1";
    const delay = this.options.delayMs ?? 18;

    yield { type: "start", id, model };

    if (request.sources && request.sources.length > 0) {
      yield { type: "sources", sources: request.sources };
    }

    const reply = composeReply(request);
    const words = reply.split(/(\s+)/);
    let emitted = "";
    try {
      for (const word of words) {
        if (!word) continue;
        await sleep(delay, request.signal);
        emitted += word;
        yield { type: "text-delta", delta: word };
        if (request.maxTokens && estimateTokens(emitted) >= request.maxTokens) {
          yield { type: "usage", usage: { inputTokens: estimateTokens(request.messages.map((m) => m.content).join("\n")), outputTokens: estimateTokens(emitted) } };
          yield { type: "done", finishReason: "length" };
          return;
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        yield { type: "done", finishReason: "cancelled" };
        return;
      }
      throw error;
    }

    yield {
      type: "usage",
      usage: {
        inputTokens: estimateTokens(request.messages.map((m) => m.content).join("\n")),
        outputTokens: estimateTokens(emitted),
      },
    };
    yield { type: "done", finishReason: "stop" };
  }
}
