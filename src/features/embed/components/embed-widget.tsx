"use client";

import { X } from "lucide-react";
import { useMemo } from "react";

import { ChatComposer } from "@/components/chat/chat-composer";
import { ChatThread } from "@/components/chat/chat-thread";
import { useChatStream } from "@/hooks/use-chat-stream";
import type { PublicChatbotConfig } from "@/features/embed/server/embed-service";
import { cn } from "@/lib/cn";
import { readableTextColor } from "@/lib/color/contrast";

interface EmbedWidgetProps {
  config: PublicChatbotConfig;
  token: string;
  preview: boolean;
}

function requestParentClose() {
  if (typeof window === "undefined" || window.parent === window) return;
  window.parent.postMessage({ type: "dot:widget:close" }, "*");
}

/**
 * Chat UI rendered inside the customer-site iframe. Talks only to the public
 * chat endpoint using the short-lived embed token minted by the server.
 */
export function EmbedWidget({ config, token, preview }: EmbedWidgetProps) {
  const dark = config.appearance.theme === "dark";
  // The brand colour is customer-chosen, so the text on it cannot be hardcoded.
  const onPrimary = readableTextColor(config.appearance.primaryColor);
  const extras = useMemo(() => ({ embedKey: config.embedKey, token }), [config.embedKey, token]);
  const chat = useChatStream({ endpoint: "/api/public/chat", requestExtras: extras, welcomeMessage: config.welcomeMessage });
  // Widget tokens are short-lived, so a page left open overnight fails with a
  // forbidden code. Reloading the iframe mints a fresh one.
  const sessionExpired = chat.errorCode === "forbidden";

  return (
    <div className={cn("flex h-dvh flex-col", dark ? "bg-ink-900 text-white" : "bg-white text-ink-900")}>
      <header
        className="flex items-center gap-3 px-4 py-3"
        style={{ backgroundColor: config.appearance.primaryColor, color: onPrimary }}
      >
        {config.appearance.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- customer-provided asset host
          <img src={config.appearance.avatarUrl} alt="" className="size-8 rounded-full object-cover" />
        ) : (
          <span className="flex size-8 items-center justify-center rounded-full bg-current/20 text-xs font-semibold">
            {config.name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{config.name}</p>
          <p className="text-caption opacity-80">{chat.status === "streaming" ? "Typing…" : "Online"}</p>
        </div>
        <button
          type="button"
          onClick={requestParentClose}
          aria-label="Close chat"
          className="flex size-8 items-center justify-center rounded-full hover:bg-current/15 focus-ring"
        >
          <X aria-hidden className="size-4" />
        </button>
      </header>
      {preview ? (
        <p className={cn("px-4 py-1.5 text-center text-caption", dark ? "bg-ink-800 text-ink-300" : "bg-ink-100 text-ink-600")}>
          Preview mode · visible only to workspace members
        </p>
      ) : null}
      <div className={cn("flex-1 overflow-y-auto px-4 py-4 scrollbar-thin", dark ? "bg-ink-900" : "bg-ink-50")}>
        <ChatThread turns={chat.turns} onRetry={chat.retry} assistantName={config.name} accentColor={config.appearance.primaryColor} compact />
        {sessionExpired ? (
          <div role="alert" className="mt-4 rounded-lg border border-border bg-surface px-3 py-2.5 text-xs text-foreground-secondary">
            <p>This chat session expired.</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-1.5 font-medium text-foreground underline underline-offset-4 focus-ring"
            >
              Reload the chat
            </button>
          </div>
        ) : null}
      </div>
      <div className={cn("border-t p-3", dark ? "border-ink-700 bg-ink-900" : "border-border bg-white")}>
        <ChatComposer
          onSend={(text) => void chat.send(text)}
          onStop={chat.stop}
          streaming={chat.status === "streaming"}
          accentColor={config.appearance.primaryColor}
          placeholder="Type a message…"
          className={dark ? "border-ink-700 bg-ink-800 text-white" : undefined}
        />
        {config.appearance.showBranding ? (
          <p className={cn("mt-2 text-center text-caption", dark ? "text-ink-500" : "text-ink-400")}>Powered by Dot</p>
        ) : null}
      </div>
    </div>
  );
}
