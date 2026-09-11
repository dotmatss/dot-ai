"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { isApiError } from "@/lib/api/api-error";
import { streamChat } from "@/lib/ai/sse-client";
import type { RetrievedSource, TokenUsage } from "@/types/ai";

/**
 * Tool work the model reported during a turn. The payloads stay opaque here:
 * what a tool call means is a feature concern (an agent resolves it against
 * its registry), while the transport and the state machine are shared.
 */
export type ChatToolActivity =
  | { id: string; kind: "call"; name: string; arguments: unknown }
  | { id: string; kind: "result"; result: unknown };

export interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: RetrievedSource[];
  usage?: TokenUsage;
  toolActivity?: ChatToolActivity[];
  status: "complete" | "streaming" | "error" | "cancelled";
  error?: string;
}

export type ChatStatus = "idle" | "streaming" | "error";

interface UseChatStreamOptions {
  /** Endpoint that returns an SSE stream of ChatStreamEvent. */
  endpoint: string;
  /** Optional extra fields merged into every request body (e.g. embed key). */
  requestExtras?: Record<string, unknown>;
  welcomeMessage?: string;
}

function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now() + Math.random());
}

/**
 * Streaming chat state machine shared by the playground and the embeddable
 * widget. Handles partial responses, cancellation, retry and conversation
 * continuity; it is transport-agnostic beyond the SSE contract.
 */
export function useChatStream({ endpoint, requestExtras, welcomeMessage }: UseChatStreamOptions) {
  const [turns, setTurns] = useState<ChatTurn[]>(() =>
    welcomeMessage ? [{ id: "welcome", role: "assistant", content: welcomeMessage, status: "complete" }] : [],
  );
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastPromptRef = useRef<string | null>(null);
  // send() reads the transcript through a ref rather than closing over it, so
  // retry() (which fires from a timeout, after the failed pair is removed)
  // cannot rebuild the history from a stale snapshot and send the prompt twice.
  const turnsRef = useRef<ChatTurn[]>(turns);
  const statusRef = useRef<ChatStatus>(status);

  // Refs are synced after commit rather than during render.
  useEffect(() => {
    turnsRef.current = turns;
    statusRef.current = status;
  });

  // A component that unmounts mid-stream must not leave the request running:
  // the server keeps generating (and billing) until the connection closes.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const updateTurn = useCallback((id: string, patch: Partial<ChatTurn> | ((turn: ChatTurn) => ChatTurn)) => {
    setTurns((current) =>
      current.map((turn) => (turn.id === id ? (typeof patch === "function" ? patch(turn) : { ...turn, ...patch }) : turn)),
    );
  }, []);

  const send = useCallback(
    async (prompt: string) => {
      const content = prompt.trim();
      if (!content || statusRef.current === "streaming") return;
      // Claim the slot immediately: the ref only catches up after the next
      // commit, and two sends can be dispatched within one tick.
      statusRef.current = "streaming";
      setError(null);
      setErrorCode(null);
      lastPromptRef.current = content;

      const userTurn: ChatTurn = { id: makeId(), role: "user", content, status: "complete" };
      const assistantId = makeId();
      const history = turnsRef.current
        .filter((t) => t.id !== "welcome" && t.status === "complete")
        .map((t) => ({ role: t.role, content: t.content }));

      setTurns((current) => [...current, userTurn, { id: assistantId, role: "assistant", content: "", status: "streaming" }]);
      setStatus("streaming");

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const stream = await streamChat(
          endpoint,
          {
            ...requestExtras,
            conversationId: conversationIdRef.current ?? undefined,
            messages: [...history, { role: "user", content }].slice(-40),
          },
          { signal: controller.signal },
        );

        for await (const event of stream) {
          switch (event.type) {
            case "tool-result": {
              // The server announces the conversation id through this channel
              // before anything else; everything else is real tool activity.
              if (event.id === "conversation") {
                const result = event.result as { conversationId?: string };
                if (result?.conversationId) {
                  conversationIdRef.current = result.conversationId;
                  setConversationId(result.conversationId);
                }
                break;
              }
              updateTurn(assistantId, (turn) => ({
                ...turn,
                toolActivity: [...(turn.toolActivity ?? []), { id: event.id, kind: "result", result: event.result }],
              }));
              break;
            }
            case "tool-call":
              updateTurn(assistantId, (turn) => ({
                ...turn,
                toolActivity: [
                  ...(turn.toolActivity ?? []),
                  { id: event.id, kind: "call", name: event.name, arguments: event.arguments },
                ],
              }));
              break;
            case "text-delta":
              updateTurn(assistantId, (turn) => ({ ...turn, content: turn.content + event.delta }));
              break;
            case "sources":
              updateTurn(assistantId, { sources: event.sources });
              break;
            case "usage":
              updateTurn(assistantId, { usage: event.usage });
              break;
            case "error":
              updateTurn(assistantId, { status: "error", error: event.message });
              setError(event.message);
              setErrorCode(event.code ?? null);
              // Also move the machine into `error`: callers gate retry
              // affordances and status indicators on it, and the stream still
              // finishes normally after an error event.
              setStatus("error");
              break;
            case "done":
              updateTurn(assistantId, (turn) => ({
                ...turn,
                status: event.finishReason === "cancelled" ? "cancelled" : event.finishReason === "error" ? "error" : "complete",
              }));
              if (event.finishReason === "error") setStatus("error");
              break;
            default:
              break;
          }
        }
        setStatus((current) => (current === "error" ? current : "idle"));
      } catch (caught) {
        if (controller.signal.aborted) {
          updateTurn(assistantId, { status: "cancelled" });
          setStatus("idle");
        } else {
          const message = isApiError(caught) ? caught.message : "The assistant could not respond. Please try again.";
          updateTurn(assistantId, { status: "error", error: message });
          setError(message);
          setErrorCode(isApiError(caught) ? caught.code : null);
          setStatus("error");
        }
      } finally {
        abortRef.current = null;
        if (statusRef.current === "streaming") statusRef.current = "idle";
      }
    },
    [endpoint, requestExtras, updateTurn],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const retry = useCallback(() => {
    const prompt = lastPromptRef.current;
    if (!prompt) return;
    // Remove the failed assistant turn and its user prompt before resending.
    setTurns((current) => {
      const next = [...current];
      const lastAssistant = [...next].reverse().find((t) => t.role === "assistant" && t.status !== "complete");
      if (lastAssistant) next.splice(next.indexOf(lastAssistant), 1);
      const lastUser = [...next].reverse().find((t) => t.role === "user" && t.content === prompt);
      if (lastUser) next.splice(next.indexOf(lastUser), 1);
      return next;
    });
    setStatus("idle");
    setError(null);
    setErrorCode(null);
    // Defer so the removal above is committed before the resend reads it.
    window.setTimeout(() => void send(prompt), 0);
  }, [send]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    conversationIdRef.current = null;
    setConversationId(null);
    lastPromptRef.current = null;
    setError(null);
    setErrorCode(null);
    setStatus("idle");
    setTurns(welcomeMessage ? [{ id: "welcome", role: "assistant", content: welcomeMessage, status: "complete" }] : []);
  }, [welcomeMessage]);

  return { turns, status, error, errorCode, send, stop, retry, reset, conversationId };
}
