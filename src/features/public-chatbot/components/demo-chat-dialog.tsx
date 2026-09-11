"use client";

import { BookOpen, Maximize2, Minimize2, RotateCcw, Sparkles } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";

import { ChatComposer } from "@/components/chat/chat-composer";
import { ChatThread } from "@/components/chat/chat-thread";
import { AppButton } from "@/components/ui/app-button";
import { AppDialog } from "@/components/ui/app-dialog";
import {
  DEMO_ASSISTANT_NAME,
  DEMO_CHAT_ENDPOINT,
  DEMO_COMPOSER_PLACEHOLDER,
  DEMO_DIALOG_DESCRIPTION,
  DEMO_DIALOG_TITLE,
} from "@/features/public-chatbot/constants";
import { SuggestedPrompts } from "@/features/public-chatbot/components/suggested-prompts";
import { useChatStream } from "@/hooks/use-chat-stream";

/**
 * The public demo conversation.
 *
 * STATE: the transcript lives in `useChatStream`, which is React state local
 * to this dialog. It is deliberately not TanStack Query and not Zustand.
 * TanStack Query caches a request/response pair keyed by input; a token stream
 * is not that shape - it is an incremental state machine with partial content,
 * cancellation and retry, and there is nothing to cache because the same
 * question asked twice is a new answer. Zustand would make the transcript
 * global, which it is not: it belongs to one dialog, and discarding it when
 * the visitor closes the demo is the correct behaviour, not a bug.
 *
 * LOADING: this component is only imported after the first open, so none of
 * the chat code ships with the landing page.
 */
export function DemoChatDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { turns, status, error, send, stop, retry, reset } = useChatStream({ endpoint: DEMO_CHAT_ENDPOINT });
  // Phones are always full screen; this only decides whether a wide screen
  // gets the large panel or the entire viewport. It survives close and reopen
  // because the dialog stays mounted, so the choice is not re-made every time.
  const [expanded, setExpanded] = useState(false);

  const streaming = status === "streaming";
  const started = turns.length > 0;
  // The reading column widens with the surface, but never to the full width of
  // a large monitor: a chat line stretched across 2000px is hard to read.
  const columnClass = expanded ? "max-w-5xl" : "max-w-4xl";

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      fullScreen
      expanded={expanded}
      title={DEMO_DIALOG_TITLE}
      description={DEMO_DIALOG_DESCRIPTION}
      headerActions={
        <AppButton
          variant="ghost"
          size="icon-sm"
          // Hidden on phones, where the dialog already fills the screen and the
          // control would do nothing.
          className="hidden sm:inline-flex"
          onClick={() => setExpanded((value) => !value)}
          aria-pressed={expanded}
          aria-label={expanded ? "Exit full screen" : "Expand to full screen"}
        >
          {expanded ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
        </AppButton>
      }
      contentClassName="px-4 py-5 sm:px-6"
      footerClassName="border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4"
      footer={
        <div className={`mx-auto flex w-full flex-col gap-2 ${columnClass}`}>
          {started ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-caption text-foreground-subtle">
                Grounded in the docs. It will say so when something is not supported.
              </p>
              <AppButton
                variant="ghost"
                size="sm"
                onClick={reset}
                disabled={streaming}
                leadingIcon={<RotateCcw aria-hidden />}
              >
                Start over
              </AppButton>
            </div>
          ) : null}
          <ChatComposer
            onSend={send}
            onStop={stop}
            streaming={streaming}
            placeholder={DEMO_COMPOSER_PLACEHOLDER}
            label={`Ask ${DEMO_ASSISTANT_NAME} a question`}
            autoFocus
          />
        </div>
      }
    >
      <div className={`mx-auto flex w-full flex-col gap-6 ${columnClass}`}>
        {started ? (
          <ChatThread turns={turns} onRetry={retry} assistantName={DEMO_ASSISTANT_NAME} />
        ) : (
          <DemoChatEmptyState onSelect={send} disabled={streaming} />
        )}

        {/* The thread announces per-message failures; this is the one place a
            visitor can see that the whole demo is unavailable. */}
        {error && !started ? (
          <p role="alert" className="rounded-lg border border-danger-border bg-danger-bg px-3.5 py-2.5 text-sm text-foreground">
            {error}
          </p>
        ) : null}
      </div>
    </AppDialog>
  );
}

function DemoChatEmptyState({ onSelect, disabled }: { onSelect: (prompt: string) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-6 py-2 sm:py-6">
      <div className="flex flex-col gap-3">
        <span className="flex size-10 items-center justify-center rounded-lg border border-border bg-surface text-foreground shadow-xs">
          <Sparkles aria-hidden className="size-5" />
        </span>
        <div>
          <p className="text-base font-semibold text-foreground">Ask anything about the platform</p>
          <p className="mt-1 max-w-prose text-sm text-foreground-muted">
            {DEMO_ASSISTANT_NAME} answers from the product documentation, so it will tell you plainly when something is
            not supported yet. This is the same streaming chat your own visitors would get.
          </p>
        </div>
      </div>

      <SuggestedPrompts onSelect={onSelect} disabled={disabled} />

      <p className="text-sm text-foreground-muted">
        Prefer to read?{" "}
        <Link
          href={"/docs" as Route}
          className="inline-flex items-center gap-1 rounded-sm font-medium text-foreground underline underline-offset-4 focus-ring"
        >
          <BookOpen aria-hidden className="size-3.5" />
          Browse the documentation
        </Link>
      </p>
    </div>
  );
}
