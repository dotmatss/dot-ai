"use client";

import { ArrowUpRight } from "lucide-react";

import { SUGGESTED_PROMPTS } from "@/features/public-chatbot/constants";

/**
 * Openers for a visitor who does not yet know what to ask.
 *
 * Rendered as a list of buttons rather than chips-that-look-like-chips: each
 * one sends a real message, so it must read and behave as an action.
 */
export function SuggestedPrompts({ onSelect, disabled }: { onSelect: (prompt: string) => void; disabled?: boolean }) {
  return (
    <div>
      <p className="text-caption font-medium uppercase tracking-caption text-foreground-subtle">Try asking</p>
      <ul className="mt-2.5 flex flex-col gap-1.5">
        {SUGGESTED_PROMPTS.map((suggestion) => (
          <li key={suggestion.prompt}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onSelect(suggestion.prompt)}
              className="group flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3.5 py-2.5 text-left text-sm text-foreground-secondary shadow-xs transition-colors focus-ring hover:border-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-60"
            >
              <span>{suggestion.label}</span>
              <ArrowUpRight
                aria-hidden
                className="size-4 shrink-0 text-foreground-subtle transition-colors group-hover:text-foreground"
              />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
