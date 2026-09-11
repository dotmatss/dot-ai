import { ApiError } from "@/lib/api/api-error";
import type { ChatStreamEvent } from "@/types/ai";

/**
 * Reads a `text/event-stream` response and yields parsed AI events. Works with
 * any fetch Response so it can be unit tested without a network.
 */
export async function* readChatStream(response: Response): AsyncGenerator<ChatStreamEvent> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        try {
          yield JSON.parse(data) as ChatStreamEvent;
        } catch {
          // Ignore malformed frames; the server always terminates with `done`.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export interface StreamChatOptions {
  signal?: AbortSignal;
}

/** POSTs a chat request and returns the parsed event stream. */
export async function streamChat(url: string, body: unknown, options: StreamChatOptions = {}): Promise<AsyncGenerator<ChatStreamEvent>> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    signal: options.signal,
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "X-Requested-With": "fetch",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw ApiError.fromPayload(response.status, (payload as { error?: unknown } | null)?.error);
  }
  return readChatStream(response);
}
