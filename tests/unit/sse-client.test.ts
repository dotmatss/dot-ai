import { describe, expect, it } from "vitest";

import { readChatStream } from "@/lib/ai/sse-client";
import type { ChatStreamEvent } from "@/types/ai";

function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
}

describe("readChatStream", () => {
  it("parses events even when frames are split across chunks", async () => {
    const events: ChatStreamEvent[] = [
      { type: "start", id: "1", model: "mock" },
      { type: "text-delta", delta: "Hel" },
      { type: "text-delta", delta: "lo" },
      { type: "done", finishReason: "stop" },
    ];
    const wire = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
    // Split mid-frame to exercise buffering.
    const frames = [wire.slice(0, 25), wire.slice(25, 70), wire.slice(70)];

    const received: ChatStreamEvent[] = [];
    for await (const event of readChatStream(sseResponse(frames))) received.push(event);
    expect(received).toEqual(events);
  });

  it("ignores comments and malformed frames", async () => {
    const frames = [": keep-alive\n\n", "data: {not json}\n\n", `data: ${JSON.stringify({ type: "done", finishReason: "stop" })}\n\n`];
    const received: ChatStreamEvent[] = [];
    for await (const event of readChatStream(sseResponse(frames))) received.push(event);
    expect(received).toEqual([{ type: "done", finishReason: "stop" }]);
  });
});
