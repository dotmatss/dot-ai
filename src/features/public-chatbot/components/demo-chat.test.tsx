import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DemoChatLauncher } from "@/features/public-chatbot/components/demo-chat-launcher";
import { DEMO_CHAT_ENDPOINT, DEMO_LAUNCHER_LABEL, SUGGESTED_PROMPTS } from "@/features/public-chatbot/constants";
import type { ChatStreamEvent } from "@/types/ai";

const streamChat = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ai/sse-client", () => ({
  streamChat,
  readChatStream: vi.fn(),
}));

/** Emits the given events, pausing where a caller wants to inspect mid-stream. */
function scriptedStream(events: ChatStreamEvent[], gate?: { wait: Promise<void>; after: ChatStreamEvent[] }) {
  return (async function* stream() {
    for (const event of events) yield event;
    if (gate) {
      await gate.wait;
      for (const event of gate.after) yield event;
    }
  })();
}

function answer(text: string): ChatStreamEvent[] {
  return [
    { type: "start", id: "1", model: "test" },
    { type: "text-delta", delta: text },
    { type: "done", finishReason: "stop" },
  ];
}

async function openDemo() {
  const user = userEvent.setup();
  render(<DemoChatLauncher />);
  await user.click(screen.getByRole("button", { name: DEMO_LAUNCHER_LABEL }));
  // The dialog is dynamically imported on first open. The generous timeout is
  // about machine load, not about the component: resolving the chunk competes
  // with every other suite when the whole project runs at once.
  await screen.findByRole("dialog", {}, { timeout: 5_000 });
  return user;
}

beforeEach(() => {
  streamChat.mockReset();
  streamChat.mockResolvedValue(scriptedStream(answer("Dot grounds answers in the documentation.")));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("public demo launcher", () => {
  it("renders a labelled launcher and no dialog until it is clicked", () => {
    render(<DemoChatLauncher />);
    const launcher = screen.getByRole("button", { name: DEMO_LAUNCHER_LABEL });
    expect(launcher).toHaveAttribute("aria-haspopup", "dialog");
    expect(launcher).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the chat and names it for assistive technology", async () => {
    await openDemo();
    const dialog = screen.getByRole("dialog");
    const heading = screen.getByRole("heading", { name: "Ask Dot" });
    expect(dialog).toHaveAttribute("aria-labelledby", heading.id);
    expect(screen.getByRole("button", { name: DEMO_LAUNCHER_LABEL })).toHaveAttribute("aria-expanded", "true");
  });

  it("closes from the close button", async () => {
    const user = await openDemo();
    await user.click(screen.getByRole("button", { name: "Close dialog" }));
    await waitFor(() => expect(screen.getByRole("button", { name: DEMO_LAUNCHER_LABEL })).toHaveAttribute("aria-expanded", "false"));
  });

  it("closes on Escape", async () => {
    await openDemo();
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    await waitFor(() => expect(screen.getByRole("button", { name: DEMO_LAUNCHER_LABEL })).toHaveAttribute("aria-expanded", "false"));
  });

  it("puts focus in the composer when it opens, so a visitor can just type", async () => {
    await openDemo();
    await waitFor(() => expect(screen.getByRole("textbox", { name: /Ask Dot a question/i })).toHaveFocus());
  });

  it("can be reopened after closing", async () => {
    const user = await openDemo();
    await user.click(screen.getByRole("button", { name: "Close dialog" }));
    await user.click(screen.getByRole("button", { name: DEMO_LAUNCHER_LABEL }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});

describe("public demo conversation", () => {
  it("offers suggested prompts in the initial state", async () => {
    await openDemo();
    for (const suggestion of SUGGESTED_PROMPTS) {
      expect(screen.getByRole("button", { name: suggestion.label })).toBeInTheDocument();
    }
  });

  it("sends a suggested prompt and shows the answer", async () => {
    const user = await openDemo();
    const first = SUGGESTED_PROMPTS[0]!;

    await user.click(screen.getByRole("button", { name: first.label }));

    expect(await screen.findByText("Dot grounds answers in the documentation.")).toBeInTheDocument();
    expect(streamChat).toHaveBeenCalledTimes(1);
    const [endpoint, body] = streamChat.mock.calls[0]!;
    expect(endpoint).toBe(DEMO_CHAT_ENDPOINT);
    expect((body as { messages: Array<{ content: string }> }).messages.at(-1)?.content).toBe(first.prompt);
  });

  it("sends a typed message and replaces the initial state with the transcript", async () => {
    const user = await openDemo();

    await user.type(screen.getByRole("textbox", { name: /Ask Dot a question/i }), "Can I use my own content?");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("Can I use my own content?")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: SUGGESTED_PROMPTS[0]!.label })).not.toBeInTheDocument();
  });

  it("shows a thinking state and a stop control while the answer streams", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    streamChat.mockResolvedValue(
      scriptedStream([{ type: "start", id: "1", model: "test" }], {
        wait: gate,
        after: [{ type: "text-delta", delta: "Yes." }, { type: "done", finishReason: "stop" }],
      }),
    );

    const user = await openDemo();
    await user.click(screen.getByRole("button", { name: SUGGESTED_PROMPTS[0]!.label }));

    // Streaming: the typing indicator is announced and sending is replaced by stop.
    expect(await screen.findByText("Dot is typing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop generating" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send message" })).not.toBeInTheDocument();

    release();
    expect(await screen.findByText("Yes.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Send message" })).toBeInTheDocument());
  });

  it("renders the answer in a live region so a screen reader hears it", async () => {
    const user = await openDemo();
    await user.click(screen.getByRole("button", { name: SUGGESTED_PROMPTS[0]!.label }));
    await screen.findByText("Dot grounds answers in the documentation.");

    const log = screen.getByRole("log");
    expect(log).toHaveAttribute("aria-live", "polite");
    expect(log).toHaveTextContent("Dot grounds answers in the documentation.");
  });

  it("shows an error with a retry action, and the retry succeeds", async () => {
    streamChat.mockResolvedValueOnce(
      scriptedStream([
        { type: "start", id: "1", model: "test" },
        { type: "error", message: "The demo is busy right now." },
        { type: "done", finishReason: "error" },
      ]),
    );

    const user = await openDemo();
    await user.click(screen.getByRole("button", { name: SUGGESTED_PROMPTS[0]!.label }));

    expect(await screen.findByText("The demo is busy right now.")).toBeInTheDocument();

    streamChat.mockResolvedValue(scriptedStream(answer("Recovered answer.")));
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Recovered answer.")).toBeInTheDocument();
    expect(screen.queryByText("The demo is busy right now.")).not.toBeInTheDocument();
  });

  it("recovers when the request itself fails, not just the stream", async () => {
    streamChat.mockRejectedValueOnce(new Error("network down"));

    const user = await openDemo();
    await user.click(screen.getByRole("button", { name: SUGGESTED_PROMPTS[0]!.label }));

    expect(await screen.findByText(/could not respond/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("clears the conversation with Start over", async () => {
    const user = await openDemo();
    await user.click(screen.getByRole("button", { name: SUGGESTED_PROMPTS[0]!.label }));
    await screen.findByText("Dot grounds answers in the documentation.");

    await user.click(screen.getByRole("button", { name: "Start over" }));

    expect(screen.queryByText("Dot grounds answers in the documentation.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: SUGGESTED_PROMPTS[0]!.label })).toBeInTheDocument();
  });
});

describe("public demo layout", () => {
  it("fills the viewport instead of rendering a narrow floating window", async () => {
    await openDemo();
    const dialog = screen.getByRole("dialog");
    const className = dialog.className;

    // A phone gets a true full-screen surface; the panel only appears from `sm` up.
    expect(className).toContain("h-dvh");
    expect(className).toContain("w-screen");
    expect(className).toContain("max-w-none");
    expect(className).toContain("rounded-none");
    expect(className).toContain("sm:rounded-xl");
    // None of the fixed form-dialog widths leak in.
    expect(className).not.toMatch(/(^|\s)max-w-(sm|md|2xl|4xl)(\s|$)/);
  });

  it("gives a wide screen a large panel rather than a form-sized modal", async () => {
    await openDemo();
    const className = screen.getByRole("dialog").className;
    expect(className).toContain("sm:max-w-7xl");
    expect(className).not.toMatch(/sm:max-w-(sm|md|lg|xl|2xl|3xl|4xl|5xl)(\s|$)/);
  });

  it("expands to the whole viewport and back from the header control", async () => {
    const user = await openDemo();
    const dialog = screen.getByRole("dialog");

    const expand = screen.getByRole("button", { name: "Expand to full screen" });
    expect(expand).toHaveAttribute("aria-pressed", "false");
    // The panel breakpoints are present before expanding.
    expect(dialog.className).toContain("sm:max-w-7xl");

    await user.click(expand);

    const collapse = screen.getByRole("button", { name: "Exit full screen" });
    expect(collapse).toHaveAttribute("aria-pressed", "true");
    // Expanded emits no breakpoint width at all, so nothing competes with it.
    expect(dialog.className).toContain("w-screen");
    expect(dialog.className).not.toContain("sm:max-w-7xl");
    expect(dialog.className).not.toContain("sm:rounded-xl");

    await user.click(collapse);
    expect(screen.getByRole("button", { name: "Expand to full screen" })).toBeInTheDocument();
    expect(dialog.className).toContain("sm:max-w-7xl");
  });

  it("keeps the expand choice when the demo is closed and reopened", async () => {
    const user = await openDemo();
    await user.click(screen.getByRole("button", { name: "Expand to full screen" }));
    await user.click(screen.getByRole("button", { name: "Close dialog" }));
    await user.click(screen.getByRole("button", { name: DEMO_LAUNCHER_LABEL }));

    expect(await screen.findByRole("button", { name: "Exit full screen" }, { timeout: 5_000 })).toBeInTheDocument();
  });

  it("keeps the composer and the close action reachable outside the scrolling transcript", async () => {
    await openDemo();
    const dialog = screen.getByRole("dialog");
    const composer = screen.getByRole("textbox", { name: /Ask Dot a question/i });
    const scroller = dialog.querySelector(".overflow-y-auto");

    expect(scroller).not.toBeNull();
    // The composer lives in the footer, so a long conversation never pushes it away.
    expect(scroller?.contains(composer)).toBe(false);
    expect(scroller?.contains(screen.getByRole("button", { name: "Close dialog" }))).toBe(false);
  });
});
