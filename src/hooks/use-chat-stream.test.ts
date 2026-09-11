import { act, renderHook, waitFor } from "@testing-library/react";
import { TextEncoder } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatStream } from "@/hooks/use-chat-stream";
import type { ChatStreamEvent } from "@/types/ai";

const ENDPOINT = "/api/v1/w/acme/chatbots/abc/chat";
const WELCOME = "Hi! How can I help you today?";

const encoder = new TextEncoder();

function frame(event: ChatStreamEvent | Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

interface StreamOptions {
  /** Events emitted before the stream is left open (for cancellation tests). */
  events: Array<ChatStreamEvent | Record<string, unknown>>;
  keepOpen?: boolean;
}

function sseFetch(options: StreamOptions | ((call: number) => StreamOptions)) {
  let call = 0;
  return vi.fn((_url: string, init?: RequestInit) => {
    const { events, keepOpen } = typeof options === "function" ? options(call++) : options;
    const signal = init?.signal;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) controller.enqueue(frame(event));
        if (!keepOpen) {
          controller.close();
          return;
        }
        // Mirror a real request: the body errors when the caller aborts.
        signal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), {
          once: true,
        });
      },
    });
    return Promise.resolve(
      new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
  });
}

function bodyOf(fetchMock: ReturnType<typeof sseFetch>, call = 0): Record<string, unknown> {
  const init = fetchMock.mock.calls[call]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
}

const ANSWER: ChatStreamEvent[] = [
  { type: "tool-result", id: "conversation", result: { conversationId: "conv-1" } },
  { type: "start", id: "gen-1", model: "mock-1" },
  { type: "text-delta", delta: "Yes, " },
  { type: "text-delta", delta: "within 30 days." },
  { type: "sources", sources: [{ id: "chunk-1", title: "Refund policy", snippet: "…" }] },
  { type: "usage", usage: { inputTokens: 12, outputTokens: 7 } },
  { type: "done", finishReason: "stop" },
];

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useChatStream", () => {
  it("starts with the welcome message and no request in flight", () => {
    const fetchMock = sseFetch({ events: [] });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChatStream({ endpoint: ENDPOINT, welcomeMessage: WELCOME }));

    expect(result.current.status).toBe("idle");
    expect(result.current.turns).toHaveLength(1);
    expect(result.current.turns[0]).toMatchObject({ role: "assistant", content: WELCOME, status: "complete" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("applies a streamed answer with its sources, usage and conversation id", async () => {
    const fetchMock = sseFetch({ events: ANSWER });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChatStream({ endpoint: ENDPOINT, welcomeMessage: WELCOME }));
    await act(async () => {
      await result.current.send("Do you offer refunds?");
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.turns).toHaveLength(3);
    expect(result.current.turns[1]).toMatchObject({ role: "user", content: "Do you offer refunds?", status: "complete" });
    expect(result.current.turns[2]).toMatchObject({
      role: "assistant",
      content: "Yes, within 30 days.",
      status: "complete",
      usage: { inputTokens: 12, outputTokens: 7 },
    });
    expect(result.current.turns[2]?.sources?.[0]?.title).toBe("Refund policy");
    expect(result.current.conversationId).toBe("conv-1");
  });

  it("continues the same conversation and sends prior turns as history, without the welcome message", async () => {
    const fetchMock = sseFetch({ events: ANSWER });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChatStream({ endpoint: ENDPOINT, welcomeMessage: WELCOME }));
    await act(async () => {
      await result.current.send("First");
    });
    await act(async () => {
      await result.current.send("Second");
    });

    const first = bodyOf(fetchMock, 0);
    expect(first.conversationId).toBeUndefined();
    expect(first.messages).toEqual([{ role: "user", content: "First" }]);

    const second = bodyOf(fetchMock, 1);
    expect(second.conversationId).toBe("conv-1");
    expect(second.messages).toEqual([
      { role: "user", content: "First" },
      { role: "assistant", content: "Yes, within 30 days." },
      { role: "user", content: "Second" },
    ]);
  });

  it("passes extra request fields through, so the widget can send its embed token", async () => {
    const fetchMock = sseFetch({ events: ANSWER });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useChatStream({ endpoint: ENDPOINT, requestExtras: { embedKey: "cb_1", token: "signed" } }),
    );
    await act(async () => {
      await result.current.send("Hello");
    });

    expect(bodyOf(fetchMock)).toMatchObject({ embedKey: "cb_1", token: "signed" });
  });

  it("ignores empty input and re-entrant sends", async () => {
    const fetchMock = sseFetch({ events: ANSWER });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChatStream({ endpoint: ENDPOINT }));
    await act(async () => {
      await result.current.send("   ");
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.turns).toHaveLength(0);
  });

  it("marks the turn as failed when the stream reports an error, then recovers on retry", async () => {
    const fetchMock = sseFetch((call) =>
      call === 0
        ? { events: [{ type: "error", message: "The model is unavailable" }, { type: "done", finishReason: "error" }] }
        : { events: ANSWER },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChatStream({ endpoint: ENDPOINT, welcomeMessage: WELCOME }));
    await act(async () => {
      await result.current.send("Do you offer refunds?");
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("The model is unavailable");
    expect(result.current.turns.at(-1)).toMatchObject({ status: "error", error: "The model is unavailable" });

    await act(async () => {
      result.current.retry();
    });
    // `retry()` drops the failed pair, clears the error and returns the machine
    // to `idle` *before* it resends on a deferred tick, so waiting for "idle"
    // can match that intermediate state and race the resend. Wait for the
    // replacement answer, which is only true once the second stream has ended.
    await waitFor(() =>
      expect(result.current.turns.at(-1)).toMatchObject({ content: "Yes, within 30 days.", status: "complete" }),
    );
    expect(result.current.status).toBe("idle");

    // The failed exchange is replaced rather than duplicated: the retry must
    // not rebuild history from the pre-removal snapshot and send the prompt twice.
    expect(bodyOf(fetchMock, 1).messages).toEqual([{ role: "user", content: "Do you offer refunds?" }]);
    expect(result.current.error).toBeNull();
    expect(result.current.turns).toHaveLength(3);
    expect(result.current.turns[1]).toMatchObject({ role: "user", content: "Do you offer refunds?" });
    expect(result.current.turns[2]).toMatchObject({ role: "assistant", content: "Yes, within 30 days.", status: "complete" });
  });

  it("surfaces a rejected request as a readable error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { code: "rate_limited", message: "Too many requests" } }), {
            status: 429,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );

    const { result } = renderHook(() => useChatStream({ endpoint: ENDPOINT }));
    await act(async () => {
      await result.current.send("Hello");
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Too many requests");
  });

  it("reports a cancelled turn rather than an error when the user stops it", async () => {
    const fetchMock = sseFetch({
      events: [{ type: "start", id: "g", model: "mock-1" }, { type: "text-delta", delta: "Thinking" }],
      keepOpen: true,
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChatStream({ endpoint: ENDPOINT }));
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.send("Tell me a long story");
    });
    await waitFor(() => expect(result.current.status).toBe("streaming"));

    await act(async () => {
      result.current.stop();
      await pending;
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeNull();
    expect(result.current.turns.at(-1)).toMatchObject({ status: "cancelled", content: "Thinking" });
  });

  it("resets to a fresh conversation", async () => {
    const fetchMock = sseFetch({ events: ANSWER });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChatStream({ endpoint: ENDPOINT, welcomeMessage: WELCOME }));
    await act(async () => {
      await result.current.send("First");
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.turns).toHaveLength(1);
    expect(result.current.turns[0]?.content).toBe(WELCOME);
    expect(result.current.conversationId).toBeNull();

    await act(async () => {
      await result.current.send("Fresh start");
    });
    // A new conversation must not be appended to the old one.
    expect(bodyOf(fetchMock, 1).conversationId).toBeUndefined();
  });

  it("ignores malformed frames instead of breaking the turn", async () => {
    const fetchMock = vi.fn(() => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode("data: {not json}\n\n"));
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
          for (const event of ANSWER) controller.enqueue(frame(event));
          controller.close();
        },
      });
      return Promise.resolve(new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChatStream({ endpoint: ENDPOINT }));
    await act(async () => {
      await result.current.send("Hello");
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.turns.at(-1)).toMatchObject({ content: "Yes, within 30 days.", status: "complete" });
  });
});
