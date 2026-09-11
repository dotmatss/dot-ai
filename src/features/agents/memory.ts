import type { AgentMemoryConfig } from "@/features/agents/types";
import type { ChatMessage } from "@/types/ai";

export interface AgentTurnMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Applies an agent's memory config to the transcript before it is sent to the
 * model. Trimming happens here rather than in the gateway so the window is a
 * product decision the customer controls, and so the cost of a long-running
 * conversation stays bounded.
 */
export function selectMemoryWindow(messages: readonly AgentTurnMessage[], memory: AgentMemoryConfig): ChatMessage[] {
  if (messages.length === 0) return [];

  if (!memory.enabled) {
    // Memory off: the agent only ever sees the request it must answer now.
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    return lastUser ? [{ role: "user", content: lastUser.content }] : [];
  }

  const windowSize = Math.max(1, Math.floor(memory.windowMessages));
  const kept = messages.slice(-windowSize);
  const dropped = messages.slice(0, messages.length - kept.length);
  const window: ChatMessage[] = kept.map((message) => ({ role: message.role, content: message.content }));

  if (memory.summarize && dropped.length > 0) {
    window.unshift({ role: "system", content: summarizeDroppedMessages(dropped) });
  }
  return window;
}

/**
 * Condenses messages that fell outside the window. This is a deterministic
 * extract rather than a model call: summarizing with the model would add a
 * second billable request to every turn.
 */
export function summarizeDroppedMessages(dropped: readonly AgentTurnMessage[]): string {
  const lines = dropped.slice(-12).map((message) => {
    const speaker = message.role === "user" ? "User" : "Agent";
    const text = message.content.replace(/\s+/g, " ").trim();
    return `- ${speaker}: ${text.length > 160 ? `${text.slice(0, 157)}…` : text}`;
  });
  return [
    `Summary of ${dropped.length} earlier message${dropped.length === 1 ? "" : "s"} in this conversation:`,
    ...lines,
    "Treat the summary as background only; the messages that follow are the live conversation.",
  ].join("\n");
}
