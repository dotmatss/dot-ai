import "server-only";

import type { ChatStreamEvent } from "@/types/ai";

/**
 * Encodes a stream of AI events as Server-Sent Events. The client parser lives
 * in `src/lib/ai/sse-client.ts`; both sides share the `ChatStreamEvent` type.
 */
export function eventsToSseResponse(
  events: AsyncIterable<ChatStreamEvent>,
  options: { signal?: AbortSignal; onEvent?: (event: ChatStreamEvent) => void | Promise<void>; onFinish?: () => void | Promise<void> } = {},
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of events) {
          if (options.signal?.aborted) break;
          await options.onEvent?.(event);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Stream failed";
        const errorEvent: ChatStreamEvent = { type: "error", message };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done", finishReason: "error" })}\n\n`));
      } finally {
        await options.onFinish?.();
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
