// @vitest-environment node
import { describe, expect, it } from "vitest";

import { readChatStream } from "@/lib/ai/sse-client";
import { MockAiGateway } from "@/server/ai/mock-gateway";
import { eventsToSseResponse } from "@/server/ai/sse";
import type { ChatMessage, ChatStreamEvent, RetrievedSource } from "@/types/ai";

const USER_QUESTION = "Do you offer refunds?";

function messages(): ChatMessage[] {
  return [
    { role: "system", content: "You are a concise billing assistant." },
    { role: "user", content: USER_QUESTION },
  ];
}

async function collect(events: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const out: ChatStreamEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

function textOf(events: ChatStreamEvent[]): string {
  return events
    .filter((event): event is Extract<ChatStreamEvent, { type: "text-delta" }> => event.type === "text-delta")
    .map((event) => event.delta)
    .join("");
}

/**
 * Exercises the whole AI boundary the application depends on: gateway events →
 * Server-Sent Events on the wire → the client parser. A regression in any of
 * the three shows up here rather than only in the browser.
 */
describe("AI boundary round trip", () => {
  it("streams a grounded answer from gateway to client through SSE", async () => {
    const gateway = new MockAiGateway({ delayMs: 0 });
    const sources: RetrievedSource[] = [
      { id: "chunk-1", title: "Refund policy", snippet: "Refunds are available within 30 days.", uri: "https://acme.test/refunds" },
    ];

    const response = eventsToSseResponse(
      gateway.streamChat({ messages: messages(), sources, signal: new AbortController().signal }),
    );
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toContain("no-cache");
    // Proxies must not buffer a token stream.
    expect(response.headers.get("x-accel-buffering")).toBe("no");

    const events = await collect(readChatStream(response));

    expect(events[0]?.type).toBe("start");
    expect(events.at(-1)).toEqual({ type: "done", finishReason: "stop" });

    const sourceEvent = events.find((event) => event.type === "sources");
    expect(sourceEvent).toEqual({ type: "sources", sources });

    const text = textOf(events);
    expect(text).toContain(`You asked: "${USER_QUESTION}"`);
    // A grounded answer cites the retrieved source.
    expect(text).toContain("Refund policy");
    expect(text).toContain("[1]");

    const usage = events.find((event) => event.type === "usage");
    expect(usage).toBeDefined();
    if (usage?.type === "usage") {
      expect(usage.usage.inputTokens).toBeGreaterThan(0);
      expect(usage.usage.outputTokens).toBeGreaterThan(0);
    }
  });

  it("reports cancellation instead of an error when the caller aborts", async () => {
    const gateway = new MockAiGateway({ delayMs: 1 });
    const controller = new AbortController();
    const events: ChatStreamEvent[] = [];

    for await (const event of gateway.streamChat({ messages: messages(), signal: controller.signal })) {
      events.push(event);
      if (events.filter((e) => e.type === "text-delta").length === 2) controller.abort();
    }

    expect(events.at(-1)).toEqual({ type: "done", finishReason: "cancelled" });
    expect(events.some((event) => event.type === "error")).toBe(false);
  });

  it("stops at the token ceiling and says why", async () => {
    const gateway = new MockAiGateway({ delayMs: 0 });
    const events = await collect(
      gateway.streamChat({ messages: messages(), maxTokens: 4, signal: new AbortController().signal }),
    );

    expect(events.at(-1)).toEqual({ type: "done", finishReason: "length" });
    expect(textOf(events).length).toBeGreaterThan(0);
  });

  it("surfaces a gateway failure as an error event followed by a terminal done", async () => {
    async function* failing(): AsyncIterable<ChatStreamEvent> {
      yield { type: "start", id: "x", model: "test" };
      yield { type: "text-delta", delta: "partial" };
      throw new Error("upstream exploded");
    }

    const events = await collect(readChatStream(eventsToSseResponse(failing())));

    expect(textOf(events)).toBe("partial");
    const error = events.find((event) => event.type === "error");
    expect(error).toBeDefined();
    if (error?.type === "error") {
      expect(error.message).toBe("upstream exploded");
    }
    expect(events.at(-1)).toEqual({ type: "done", finishReason: "error" });
  });

  it("runs onEvent for every event and onFinish once, so persistence cannot be skipped", async () => {
    const gateway = new MockAiGateway({ delayMs: 0 });
    const seen: string[] = [];
    let finished = 0;

    const response = eventsToSseResponse(gateway.streamChat({ messages: messages() }), {
      onEvent: (event) => {
        seen.push(event.type);
      },
      onFinish: () => {
        finished += 1;
      },
    });
    await collect(readChatStream(response));

    expect(seen[0]).toBe("start");
    expect(seen).toContain("text-delta");
    expect(seen.at(-1)).toBe("done");
    expect(finished).toBe(1);
  });
});
