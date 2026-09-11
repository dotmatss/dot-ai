"use client";

import { CircleAlert, Link2, RefreshCw } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { AppButton } from "@/components/ui/app-button";
import type { ChatToolActivity, ChatTurn } from "@/hooks/use-chat-stream";
import { cn } from "@/lib/cn";
import { readableTextColor } from "@/lib/color/contrast";

interface ChatThreadProps {
  turns: ChatTurn[];
  onRetry?: () => void;
  assistantName: string;
  accentColor?: string;
  compact?: boolean;
  /**
   * Renders the tool work reported during an assistant turn. Left to the
   * caller because only the feature knows what its tools mean; chatbots pass
   * nothing and the activity simply does not appear.
   */
  renderToolActivity?: (activity: ChatToolActivity[]) => ReactNode;
}

function StreamingCursor() {
  return <span aria-hidden className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-xs bg-current align-[-2px]" />;
}

/**
 * Message list for chatbot conversations. Renders partial responses, sources
 * (citations), usage, error and cancelled states; shared by playground and widget.
 */
export function ChatThread({
  turns,
  onRetry,
  assistantName,
  // The chatbot's stored brand colour, which is a customer setting rather than
  // a theme token; the bubble's text is computed from it by readableTextColor.
  // This default only mirrors CHATBOT_DEFAULTS.primaryColor.
  accentColor = "#111111",
  compact,
  renderToolActivity,
}: ChatThreadProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const lastTurn = turns[turns.length - 1];

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns.length, lastTurn?.content.length, lastTurn?.toolActivity?.length]);

  return (
    // aria-relevant stays at the default ("additions text" would make a screen
    // reader re-read the whole reply on every streamed token).
    <div role="log" aria-live="polite" className={cn("flex flex-col gap-4 text-sm")}>
      {turns.map((turn) => {
        const isUser = turn.role === "user";
        return (
          <div key={turn.id} className={cn("flex flex-col gap-1", isUser ? "items-end" : "items-start")}>
            <span className="sr-only">{isUser ? "You" : assistantName}</span>
            {!isUser && renderToolActivity && turn.toolActivity?.length ? renderToolActivity(turn.toolActivity) : null}
            <div
              className={cn(
                "max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3.5 py-2.5 leading-6",
                isUser ? "rounded-tr-sm" : "rounded-tl-sm border border-border bg-surface text-foreground shadow-xs",
                turn.status === "error" && !isUser && "border-danger-border bg-danger-bg",
              )}
              style={isUser ? { backgroundColor: accentColor, color: readableTextColor(accentColor) } : undefined}
            >
              {turn.content}
              {turn.status === "streaming" && turn.content.length === 0 ? (
                <span className="inline-flex items-center gap-1 text-foreground-muted">
                  <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-current" />
                  <span className="sr-only">{assistantName} is typing</span>
                </span>
              ) : null}
              {turn.status === "streaming" && turn.content.length > 0 ? <StreamingCursor /> : null}
              {turn.status === "cancelled" ? <span className="mt-1 block text-xs text-foreground-muted">Response stopped.</span> : null}
              {turn.status === "error" ? (
                <span className="mt-1 flex items-center gap-1.5 text-xs text-danger">
                  <CircleAlert aria-hidden className="size-3.5" />
                  {turn.error ?? "Something went wrong."}
                </span>
              ) : null}
            </div>
            {!isUser && turn.sources && turn.sources.length > 0 ? (
              <ul className="flex max-w-[85%] flex-wrap gap-1.5" aria-label="Sources">
                {turn.sources.map((source, index) => (
                  <li key={source.id}>
                    {source.uri ? (
                      <a
                        href={source.uri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-6 items-center gap-1 rounded-full border border-border bg-surface px-2 text-caption text-foreground-secondary hover:border-border-strong hover:text-foreground focus-ring"
                        title={source.snippet}
                      >
                        <Link2 aria-hidden className="size-3" />[{index + 1}] {source.title}
                      </a>
                    ) : (
                      <span
                        className="inline-flex h-6 items-center gap-1 rounded-full border border-border bg-surface px-2 text-caption text-foreground-secondary"
                        title={source.snippet}
                      >
                        [{index + 1}] {source.title}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
            {!isUser && turn.usage && !compact ? (
              <span className="text-caption text-foreground-subtle tabular-nums">
                {turn.usage.inputTokens.toLocaleString()} in · {turn.usage.outputTokens.toLocaleString()} out
              </span>
            ) : null}
            {!isUser && turn.status === "error" && onRetry ? (
              <AppButton variant="secondary" size="sm" onClick={onRetry} leadingIcon={<RefreshCw aria-hidden />}>
                Retry
              </AppButton>
            ) : null}
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
