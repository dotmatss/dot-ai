import { describe, expect, it } from "vitest";

import { buildSummaryTranscript, transcriptSpeaker, type TranscriptCaps } from "@/features/conversations/transcript";
import type { ConversationMessage } from "@/features/conversations/types";

type Turn = Pick<ConversationMessage, "role" | "content" | "author">;

function turn(role: ConversationMessage["role"], content: string, author: ConversationMessage["author"] = null): Turn {
  return { role, content, author };
}

const CAPS: TranscriptCaps = { maxMessages: 4, maxMessageChars: 20, maxTranscriptChars: 60 };

describe("transcriptSpeaker", () => {
  it("labels an assistant turn written by a person as Team", () => {
    expect(transcriptSpeaker(turn("assistant", "hi"))).toBe("Assistant");
    expect(transcriptSpeaker(turn("assistant", "hi", { id: "u1", name: "Ada" }))).toBe("Team");
    expect(transcriptSpeaker(turn("user", "hi"))).toBe("Visitor");
    expect(transcriptSpeaker(turn("tool", "{}"))).toBe("Tool");
  });
});

describe("buildSummaryTranscript", () => {
  it("keeps the newest turns when the message cap bites", () => {
    const messages = [turn("user", "one"), turn("assistant", "two"), turn("user", "three"), turn("assistant", "four"), turn("user", "five")];
    const transcript = buildSummaryTranscript(messages, { ...CAPS, maxTranscriptChars: 400 });
    expect(transcript).toBe("Assistant: two\n\nVisitor: three\n\nAssistant: four\n\nVisitor: five");
  });

  it("labels a team reply by its author, not by the assistant role it is stored under", () => {
    const messages = [turn("user", "help"), turn("assistant", "on it", { id: "u1", name: "Ada" })];
    expect(buildSummaryTranscript(messages, { ...CAPS, maxTranscriptChars: 400 })).toBe("Visitor: help\n\nTeam: on it");
  });

  it("truncates a long turn rather than dropping it", () => {
    const transcript = buildSummaryTranscript([turn("user", "y".repeat(50))], CAPS);
    expect(transcript).toBe(`Visitor: ${"y".repeat(20)}…`);
  });

  it("drops the oldest turns until the transcript fits the character budget", () => {
    const messages = [turn("user", "aaaaaaaaaaaaaaa"), turn("assistant", "bbbbbbbbbbbbbbb"), turn("user", "ccccccccccccccc")];
    const transcript = buildSummaryTranscript(messages, CAPS);
    expect(transcript.length).toBeLessThanOrEqual(CAPS.maxTranscriptChars);
    expect(transcript).toContain("ccccccccccccccc");
    expect(transcript).not.toContain("aaaaaaaaaaaaaaa");
  });

  it("normalizes whitespace-only turns out of the transcript", () => {
    expect(buildSummaryTranscript([turn("system", "   "), turn("user", "hello")], CAPS)).toBe("Visitor: hello");
  });

  it("returns an empty string for an empty thread so the caller can refuse to call the model", () => {
    expect(buildSummaryTranscript([], CAPS)).toBe("");
  });
});
