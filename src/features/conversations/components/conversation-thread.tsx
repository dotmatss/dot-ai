"use client";

import { Bot, Headset, Link2, Settings2, User, Wrench } from "lucide-react";
import type { ReactNode } from "react";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppCodeBlock } from "@/components/ui/app-code-block";
import { AppRelativeTime } from "@/components/ui/app-relative-time";
import { MESSAGE_ROLE_META, TEAM_AUTHOR_LABEL } from "@/features/conversations/constants";
import type { ConversationMessage } from "@/features/conversations/types";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format/number";

type MessageKind = "user" | "assistant" | "team" | "system" | "tool";

/**
 * Every kind is distinguished by its label and icon first; the surface only
 * reinforces it. Team replies are stored as assistant turns, so the author is
 * what separates the two.
 */
const KIND_STYLES: Record<MessageKind, { icon: ReactNode; body: string }> = {
  user: { icon: <User aria-hidden />, body: "border-border bg-surface-muted" },
  assistant: { icon: <Bot aria-hidden />, body: "border-border bg-surface" },
  team: { icon: <Headset aria-hidden />, body: "border-border border-l-2 border-l-accent bg-surface" },
  system: { icon: <Settings2 aria-hidden />, body: "border-dashed border-border bg-surface text-foreground-muted" },
  tool: { icon: <Wrench aria-hidden />, body: "border-border bg-surface font-mono text-xs" },
};

function kindOf(message: ConversationMessage): MessageKind {
  if (message.role === "assistant") return message.author ? "team" : "assistant";
  return message.role;
}

function labelFor(message: ConversationMessage, kind: MessageKind): string {
  return kind === "team" ? TEAM_AUTHOR_LABEL : MESSAGE_ROLE_META[message.role].label;
}

function MessageItem({ message }: { message: ConversationMessage }) {
  const kind = kindOf(message);
  const style = KIND_STYLES[kind];
  const label = labelFor(message, kind);

  return (
    <li>
      <article aria-label={`${label} message`} className="flex flex-col gap-1.5">
        <header className="flex items-center gap-2 text-xs">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-foreground-secondary [&_svg]:size-3.5">
            {style.icon}
          </span>
          <span className="font-medium text-foreground">{label}</span>
          {message.author ? <span className="truncate text-foreground-muted">{message.author.name}</span> : null}
          <AppRelativeTime value={message.createdAt} className="ml-auto shrink-0 text-caption text-foreground-muted" />
        </header>

        <div className={cn("whitespace-pre-wrap break-words rounded-lg border px-3.5 py-2.5 text-sm leading-6 shadow-xs", style.body)}>
          {message.content}
        </div>

        {message.sources && message.sources.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5" aria-label={`Sources cited by this ${label.toLowerCase()} message`}>
            {message.sources.map((source, index) => (
              <li key={source.id ?? `${index}`}>
                {source.uri ? (
                  <a
                    href={source.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={source.snippet}
                    className="inline-flex h-6 items-center gap-1 rounded-full border border-border bg-surface px-2 text-caption text-foreground-secondary hover:border-border-strong hover:text-foreground focus-ring"
                  >
                    <Link2 aria-hidden className="size-3" />[{index + 1}] {source.title}
                  </a>
                ) : (
                  <span
                    title={source.snippet}
                    className="inline-flex h-6 items-center gap-1 rounded-full border border-border bg-surface px-2 text-caption text-foreground-secondary"
                  >
                    [{index + 1}] {source.title}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : null}

        {message.toolCalls && message.toolCalls.length > 0 ? (
          <details className="group">
            <summary className="inline-flex cursor-pointer items-center gap-1 rounded-sm text-caption font-medium text-foreground-secondary hover:text-foreground focus-ring">
              {message.toolCalls.length === 1 ? "1 tool call" : `${message.toolCalls.length} tool calls`}
              <span aria-hidden className="text-foreground-subtle group-open:hidden">
                (show)
              </span>
              <span aria-hidden className="hidden text-foreground-subtle group-open:inline">
                (hide)
              </span>
            </summary>
            <AppCodeBlock className="mt-2" label="tool calls" code={JSON.stringify(message.toolCalls, null, 2)} />
          </details>
        ) : null}

        {message.usage ? (
          <p className="text-caption tabular-nums text-foreground-subtle">
            {formatNumber(message.usage.inputTokens)} tokens in · {formatNumber(message.usage.outputTokens)} tokens out
          </p>
        ) : null}
      </article>
    </li>
  );
}

interface ConversationThreadProps {
  messages: ConversationMessage[];
  /** Total on the conversation record, so a capped thread can say so. */
  totalMessageCount: number;
}

export function ConversationThread({ messages, totalMessageCount }: ConversationThreadProps) {
  if (messages.length === 0) {
    return (
      <AppEmptyState
        size="sm"
        title="No messages yet"
        description="This conversation was created but nothing has been said in it."
      />
    );
  }

  const olderCount = Math.max(0, totalMessageCount - messages.length);

  return (
    <div className="flex flex-col gap-4">
      {olderCount > 0 ? (
        <p className="rounded-md border border-border bg-surface-muted px-3 py-2 text-xs text-foreground-muted">
          Showing the {messages.length} most recent messages. {formatNumber(olderCount)} older{" "}
          {olderCount === 1 ? "message is" : "messages are"} not displayed.
        </p>
      ) : null}
      <ol className="flex flex-col gap-5">
        {messages.map((message) => (
          <MessageItem key={message.id} message={message} />
        ))}
      </ol>
    </div>
  );
}
